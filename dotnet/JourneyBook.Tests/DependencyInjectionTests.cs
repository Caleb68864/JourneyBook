using JourneyBook.Application;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace JourneyBook.Tests;

public class DependencyInjectionTests
{
    /// <summary>
    /// The web client's own patience, from <c>apps/web/src/api/render-polling.ts</c>
    /// (<c>DEFAULT_TIMEOUT_MS = 15 * 60 * 1000</c>). The server-side cap must not be
    /// shorter than this: if it is, every render longer than the cap is killed by the
    /// API's own <c>HttpClient</c> while the browser is still politely waiting.
    /// </summary>
    private static readonly TimeSpan ClientPatience = TimeSpan.FromMinutes(15);

    private static ServiceProvider BuildRoot(Dictionary<string, string?>? extra = null)
    {
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Postgres"] =
                "Host=localhost;Port=5433;Database=journeybook;Username=journeybook;Password=journeybook",
        };
        foreach (var (k, v) in extra ?? []) settings[k] = v;

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddApplication().AddInfrastructure(configuration);
        return services.BuildServiceProvider();
    }

    /// <summary>The typed client's named <c>HttpClient</c> — the one carrying the timeout.</summary>
    private static HttpClient RenderWorkerHttpClient(ServiceProvider provider) =>
        provider.GetRequiredService<IHttpClientFactory>()
            .CreateClient(nameof(IRenderWorkerClient));

    [Fact]
    public void Render_worker_timeout_defaults_to_at_least_the_clients_own_patience()
    {
        using var provider = BuildRoot();
        var http = RenderWorkerHttpClient(provider);

        // Proves we are looking at the render-worker client and not some other one.
        Assert.Equal("http://render-worker:8090/", http.BaseAddress?.ToString());

        // ADR 0006:19 names "the RenderWorker:TimeoutSeconds of 120" as one of the
        // timeouts that turned a healthy render into a failed request. The 202 moved
        // the *client's* deadline to 15 minutes and left this one at two, so an atlas
        // needing more than 120s of worker time is still killed — and reported as a
        // cancellation, which is a different and untrue thing.
        Assert.True(
            http.Timeout >= ClientPatience,
            $"RenderWorker:TimeoutSeconds default is {http.Timeout.TotalSeconds}s, " +
            $"shorter than the web client's {ClientPatience.TotalSeconds}s wait.");
    }

    [Fact]
    public void Render_worker_timeout_is_configurable()
    {
        using var provider = BuildRoot(new() { ["RenderWorker:TimeoutSeconds"] = "1234" });

        Assert.Equal(TimeSpan.FromSeconds(1234), RenderWorkerHttpClient(provider).Timeout);
    }

    [Fact]
    public void Composition_root_registers_the_dbcontext()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] =
                    "Host=localhost;Port=5433;Database=journeybook;Username=journeybook;Password=journeybook",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddApplication().AddInfrastructure(configuration);

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        // Resolving (not connecting) proves the layered wiring is intact.
        var context = scope.ServiceProvider.GetService<JourneyBookDbContext>();
        Assert.NotNull(context);
    }
}
