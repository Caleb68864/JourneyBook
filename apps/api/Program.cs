using JourneyBook.Application;
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

app.Run();
