using JourneyBook.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace JourneyBook.Tests.Api;

/// <summary>
/// Boots the real API against a throwaway PostGIS container, applies migrations,
/// and exposes an HttpClient — so endpoint tests exercise the full stack
/// (routing, EF Core, PostGIS geometry) with no mocks.
/// </summary>
public class PostgisApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    // The image goes to the constructor, not WithImage: Testcontainers deprecated the
    // parameterless ctor in 4.x precisely because an image set afterwards arrives too
    // late for the builder to configure the container against it.
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder(TestContainerImages.Postgis)
        .WithDatabase("journeybook")
        .WithUsername("journeybook")
        .WithPassword("journeybook")
        .Build();

    /// <summary>
    /// Admin key configured for the test host. The tile-source registry's write
    /// endpoints are gated (they are the SSRF entry point), and the gate fails
    /// closed, so a test host with no key configured could not create a source at
    /// all — which would make every registry test a 401 rather than a check of
    /// the behaviour it is about.
    /// </summary>
    public const string AdminKey = "test-admin-key";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Postgres", _db.GetConnectionString());
        builder.UseSetting("TileSources:AdminApiKey", AdminKey);
    }

    /// <summary>An HttpClient that presents the admin key on every request.</summary>
    public HttpClient CreateAdminClient()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(JourneyBook.Api.AdminApiKeyGate.HeaderName, AdminKey);
        return client;
    }

    public async Task InitializeAsync()
    {
        await _db.StartAsync();
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>().Database.MigrateAsync();
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await _db.DisposeAsync();
    }
}
