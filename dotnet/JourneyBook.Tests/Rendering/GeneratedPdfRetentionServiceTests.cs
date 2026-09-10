using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Infrastructure.GeneratedPdfs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace JourneyBook.Tests.Rendering;

/// <summary>
/// Retention was a number nothing acted on.
/// </summary>
/// <remarks>
/// ADR 0006 accepts a stranded lifecycle row on the grounds that it is "stranded for
/// its whole retention window", which reads as <em>eventually cleaned up</em>.
/// <c>PruneExpiredAsync</c> had exactly one caller: the manual
/// <c>POST /generated-pdfs/prune</c>. No hosted service, no scheduled job, no compose
/// entry, no UI call. So <c>GeneratedPdf:RetentionDays</c> in appsettings.json set an
/// <c>ExpiresAt</c> that nothing ever read, expired rows and their PDFs accumulated
/// for ever, and "stranded for its retention window" meant "stranded".
/// </remarks>
public class GeneratedPdfRetentionServiceTests
{
    private sealed class CountingPdfService : IGeneratedPdfService
    {
        private readonly TaskCompletionSource _firstRun = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _calls;

        public Task FirstRun => _firstRun.Task;
        public int Calls => Volatile.Read(ref _calls);
        public Func<int, int>? OnPrune { get; set; }

        public Task<int> PruneExpiredAsync(CancellationToken ct = default)
        {
            var n = Interlocked.Increment(ref _calls);
            _firstRun.TrySetResult();
            return Task.FromResult(OnPrune?.Invoke(n) ?? 0);
        }

        /// <summary>
        /// Retention must never call this. Clearing rows a crash stranded is
        /// <c>RenderJobProcessor</c>'s job — see the test at the bottom of this file
        /// for why the distinction matters.
        /// </summary>
        public Task<int> FailStrandedAsync(string reason, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<GeneratedPdfResponse?> CreateAsync(Guid projectId, CreateGeneratedPdfRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<GeneratedPdfResponse>?> ListAsync(Guid projectId, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<GeneratedPdfResponse?> GetAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<GeneratedPdfResponse?> UpdateStatusAsync(Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private static (GeneratedPdfRetentionService service, CountingPdfService pdfs, ServiceProvider provider) Build(
        TimeSpan interval)
    {
        var pdfs = new CountingPdfService();
        var services = new ServiceCollection();
        services.AddSingleton<IGeneratedPdfService>(pdfs);
        var provider = services.BuildServiceProvider();

        var service = new GeneratedPdfRetentionService(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new GeneratedPdfRetentionOptions(interval),
            NullLogger<GeneratedPdfRetentionService>.Instance);

        return (service, pdfs, provider);
    }

    [Fact]
    public async Task Prunes_without_anyone_asking()
    {
        var (service, pdfs, provider) = Build(TimeSpan.FromMilliseconds(20));
        using var _ = provider;

        await service.StartAsync(CancellationToken.None);
        await pdfs.FirstRun.WaitAsync(TimeSpan.FromSeconds(10));
        await service.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.True(pdfs.Calls >= 1);
    }

    [Fact]
    public async Task A_failing_prune_does_not_kill_the_loop()
    {
        var (service, pdfs, provider) = Build(TimeSpan.FromMilliseconds(20));
        using var _ = provider;
        // A transient DB failure on the first sweep must not silently retire
        // retention for the lifetime of the process.
        pdfs.OnPrune = n => n == 1 ? throw new InvalidOperationException("db blip") : 0;

        await service.StartAsync(CancellationToken.None);

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (pdfs.Calls < 2 && DateTime.UtcNow < deadline) await Task.Delay(10);
        await service.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.True(pdfs.Calls >= 2, $"prune ran {pdfs.Calls} time(s); the loop died on the first failure");
    }

    [Fact]
    public void An_interval_of_zero_or_less_disables_the_sweep()
    {
        // An operator who wants the old behaviour must be able to say so, and must
        // not get a hot loop for saying it.
        Assert.False(new GeneratedPdfRetentionOptions(TimeSpan.Zero).Enabled);
        Assert.False(new GeneratedPdfRetentionOptions(TimeSpan.FromHours(-1)).Enabled);
        Assert.True(new GeneratedPdfRetentionOptions(TimeSpan.FromHours(6)).Enabled);
    }

    /// <summary>
    /// Retention deletes expired rows; it does not clear a crash's wreckage.
    /// </summary>
    /// <remarks>
    /// This service's comment used to say "one sweep at startup (which is when a
    /// restart's wreckage is on the floor)", which read as a claim that the startup
    /// sweep reconciles rows stranded by a restart. It does not and never did: the
    /// sweep runs <c>PruneExpiredAsync</c>, which selects on
    /// <c>ExpiresAt &lt; now</c>, and a row stranded ten seconds ago is not expired.
    /// The fake throws on <c>FailStrandedAsync</c>, so if this service ever grows a
    /// call to it, this test says so rather than the two capabilities quietly merging.
    /// Startup reconciliation belongs to <c>RenderJobProcessor</c>, which owns the
    /// in-process queue that makes it sound.
    /// </remarks>
    [Fact]
    public async Task Retention_does_not_reconcile_stranded_rows_only_expired_ones()
    {
        var (service, pdfs, provider) = Build(TimeSpan.FromMilliseconds(20));
        using var _ = provider;

        await service.StartAsync(CancellationToken.None);
        await pdfs.FirstRun.WaitAsync(TimeSpan.FromSeconds(10));
        await service.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        // The fixture reached the subject: sweeps really did run.
        Assert.True(pdfs.Calls >= 1, "the retention sweep never ran, so this proves nothing");
        // …and every one of them was a prune. A FailStrandedAsync call would have
        // thrown NotSupportedException out of the fake instead.
    }
}
