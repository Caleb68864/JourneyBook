using JourneyBook.Application.GeneratedPdfs;
using Microsoft.Extensions.Configuration;

namespace JourneyBook.Api.Endpoints;

public static class GeneratedPdfEndpoints
{
    public static IEndpointRouteBuilder MapGeneratedPdfEndpoints(this IEndpointRouteBuilder app)
    {
        var projectScoped = app.MapGroup("/api/projects/{projectId:guid}/generated-pdfs");

        projectScoped.MapPost("/", async (Guid projectId, CreateGeneratedPdfRequest request, IGeneratedPdfService service) =>
            await service.CreateAsync(projectId, request) is { } created
                ? Results.Created($"/api/generated-pdfs/{created.Id}", created)
                : Results.NotFound());

        projectScoped.MapGet("/", async (Guid projectId, IGeneratedPdfService service) =>
            await service.ListAsync(projectId) is { } records ? Results.Ok(records) : Results.NotFound());

        var generatedPdfs = app.MapGroup("/api/generated-pdfs");

        generatedPdfs.MapGet("/{id:guid}", async (Guid id, IGeneratedPdfService service) =>
            await service.GetAsync(id) is { } record ? Results.Ok(record) : Results.NotFound());

        generatedPdfs.MapPut("/{id:guid}/status", async (Guid id, UpdateGeneratedPdfStatusRequest request, IGeneratedPdfService service) =>
            await service.UpdateStatusAsync(id, request) is { } updated ? Results.Ok(updated) : Results.NotFound());

        generatedPdfs.MapDelete("/{id:guid}", async (Guid id, IGeneratedPdfService service) =>
            await service.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        generatedPdfs.MapPost("/prune", async (IGeneratedPdfService service) =>
            Results.Ok(new PruneResult(await service.PruneExpiredAsync())));

        generatedPdfs.MapGet("/{id:guid}/content", async (
            Guid id,
            IGeneratedPdfService service,
            IConfiguration configuration) =>
        {
            var record = await service.GetAsync(id);
            if (record is null || record.FilePath is null || record.Status != "Completed")
                return Results.NotFound();

            var generatedDir = configuration["GeneratedPdf:GeneratedDir"] is { Length: > 0 } d ? d : "data/generated";
            var root = Path.GetFullPath(generatedDir);
            var resolved = Path.GetFullPath(Path.Combine(generatedDir, record.FilePath));

            if (!resolved.StartsWith(root, StringComparison.Ordinal))
                return Results.NotFound();

            if (!File.Exists(resolved))
                return Results.NotFound();

            return Results.File(resolved, "application/pdf");
        });

        return app;
    }
}
