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
    /// The web client's own patience, READ OUT OF
    /// <c>apps/web/src/api/render-polling.ts</c> rather than restated here. The
    /// server-side cap must not be shorter than it: if it is, every render longer
    /// than the cap is killed by the API's own <c>HttpClient</c> while the browser is
    /// still politely waiting.
    /// </summary>
    /// <remarks>
    /// This was <c>TimeSpan.FromMinutes(15)</c> — a hand-copy, and the reason the
    /// assertion below could not do the job it was added for. Raise
    /// <c>DEFAULT_TIMEOUT_MS</c> to 30 minutes and <c>900s &gt;= 900s</c> still passed
    /// while the server cap was silently short again: the original bug's shape,
    /// re-created inside its own fix. See <see cref="WebClientContract"/>.
    /// </remarks>
    private static TimeSpan ClientPatience => WebClientContract.ClientPatience();

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
    public void The_clients_patience_is_read_from_the_clients_own_source()
    {
        // The control for the assertion above, and the reason it is a test rather
        // than a comment: a parser that silently returned a default would compare
        // 900s against 900s forever and report success. This one throws, and this is
        // where that throw surfaces as a failure about the parser instead of as a
        // confusing verdict about a timeout.
        var patience = WebClientContract.ClientPatience();

        Assert.True(
            patience >= TimeSpan.FromMinutes(1) && patience <= TimeSpan.FromHours(2),
            $"parsed {patience} out of {WebClientContract.RenderPollingRelativePath}, which is not a " +
            "plausible browser deadline — the parser has probably matched something other than " +
            "DEFAULT_TIMEOUT_MS.");
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
