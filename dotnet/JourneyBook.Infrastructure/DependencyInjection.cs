using JourneyBook.Infrastructure.Persistence;
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

        return services;
    }
}
