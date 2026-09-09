using JourneyBook.Api;
using JourneyBook.Api.Endpoints;
using JourneyBook.Application;
using Microsoft.AspNetCore.Diagnostics;
using JourneyBook.Infrastructure;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// --- Services -------------------------------------------------------------

builder.Services.AddOpenApi();

// Layered composition: Application (use-cases) + Infrastructure (EF Core/PostGIS).
builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration);

// CORS for the Vite/React web app (origins overridable via config "Cors:AllowedOrigins").
const string WebCorsPolicy = "web";
var allowedOrigins =
    builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173", "http://localhost:8080"];

builder.Services.AddCors(options =>
    options.AddPolicy(WebCorsPolicy, policy =>
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// Optionally apply migrations on startup (off by default; enabled in Docker
// Compose where the API waits for a healthy db). Keeps local `dotnet run`
// from coupling boot to database availability.
if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
    await db.Database.MigrateAsync();
}

// --- Pipeline -------------------------------------------------------------

// Global exception handler, registered FIRST so it wraps every endpoint, and
// unconditionally so both environments answer the same shape. Without it an
// unhandled throw fell through to the host: ordinary bad input (an unknown PDF
// status) returned 500, and under Development — which Compose defaulted to
// until 2026-09-09 — that 500 carried a full stack trace.
//
// The per-endpoint try/catch blocks that already exist are deliberately left in
// place; this is a floor beneath them, not a replacement, so no endpoint's
// current response body changes.
app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var feature = context.Features.Get<IExceptionHandlerFeature>();
    var exception = feature?.Error;
    var (status, message) = exception is null
        ? (StatusCodes.Status500InternalServerError, ExceptionMapping.UnexpectedMessage)
        : ExceptionMapping.Map(exception);

    if (exception is not null && status >= StatusCodes.Status500InternalServerError)
    {
        // 5xx is our fault and the message is withheld from the client, so it has
        // to reach the log or it reaches nobody.
        context.RequestServices
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("JourneyBook.Api.UnhandledException")
            .LogError(exception, "Unhandled exception for {Method} {Path}",
                context.Request.Method, context.Request.Path);
    }

    context.Response.StatusCode = status;
    context.Response.ContentType = "application/json";

    // `{ error }`, matching what the hand-written endpoint catches already
    // return, so the web client has one error shape to render rather than two.
    // The stack trace is exposed only in Development, and only as a separate
    // field a client is free to ignore.
    var body = app.Environment.IsDevelopment() && exception is not null
        ? new Dictionary<string, object?> { ["error"] = message, ["exception"] = exception.ToString() }
        : new Dictionary<string, object?> { ["error"] = message };

    await context.Response.WriteAsJsonAsync(body);
}));

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors(WebCorsPolicy);

// Liveness: process is up.
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "journeybook-api" }))
    .WithName("Health");

// Readiness: can we reach Postgres/PostGIS?
app.MapGet("/health/db", async (JourneyBookDbContext db) =>
{
    var canConnect = await db.Database.CanConnectAsync();
    return canConnect
        ? Results.Ok(new { status = "ok", database = "reachable" })
        : Results.Json(new { status = "degraded", database = "unreachable" }, statusCode: 503);
})
    .WithName("HealthDb");

app.MapProjectEndpoints();
app.MapLocationEndpoints();
app.MapLandmarkEndpoints();
app.MapGeocodeEndpoints();
app.MapTileSourceEndpoints();
app.MapGeneratedPdfEndpoints();
app.MapRenderEndpoints();
app.MapTileEndpoints();

app.Run();

// Exposed for WebApplicationFactory integration tests.
public partial class Program;
