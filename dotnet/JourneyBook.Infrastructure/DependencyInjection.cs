using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Locations;
using JourneyBook.Application.Projects;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.GeneratedPdfs;
using JourneyBook.Infrastructure.Locations;
using JourneyBook.Infrastructure.Persistence;
using JourneyBook.Infrastructure.Projects;
using JourneyBook.Infrastructure.TileSources;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace JourneyBook.Infrastructure;

/// <summary>
/// Composition root for the Infrastructure layer: EF Core / Npgsql / PostGIS
/// and (later) repositories and external integrations.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString =
            configuration.GetConnectionString("Postgres")
            ?? "Host=localhost;Port=5433;Database=journeybook;Username=journeybook;Password=journeybook";

        services.AddDbContext<JourneyBookDbContext>(options =>
            options.UseNpgsql(connectionString, npgsql => npgsql.UseNetTopologySuite()));

        services.AddScoped<IProjectService, ProjectService>();
        services.AddScoped<ILocationService, LocationService>();
        services.AddScoped<ITileSourceService, TileSourceService>();
        services.AddScoped<IGeneratedPdfService, GeneratedPdfService>();

        return services;
    }
}
