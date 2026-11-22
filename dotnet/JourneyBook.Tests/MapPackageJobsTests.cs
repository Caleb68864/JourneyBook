using JourneyBook.Infrastructure.Tiles;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace JourneyBook.Tests;

/// <summary>
/// <see cref="MapPackageJobs"/> following a worker job, Docker-free: a scripted worker client,
/// and a failing job so no registration (and no database) is needed.
/// </summary>
public class MapPackageJobsTests
{
    /// <summary>Answers <c>Start</c>, then throws on the first <paramref name="blips"/> polls, then reports failed.</summary>
    private sealed class ScriptedWorker(int blips) : IPackageWorkerClient
    {
        public int Polls { get; private set; }

        public Task<PackageWorkerJob> StartAsync(PackageWorkerRequest request, CancellationToken ct = default) =>
            Task.FromResult(new PackageWorkerJob("job-1", "packaging", request.OutputName));

        public Task<PackageWorkerJob?> GetAsync(string id, CancellationToken ct = default)
        {
            Polls++;
            if (Polls <= blips) throw new HttpRequestException("Connection refused (worker restarting its GC)");
            return Task.FromResult<PackageWorkerJob?>(new PackageWorkerJob(id, "failed", "a.pmtiles", Error: "the worker's own reason"));
        }
    }

    private static (MapPackageJobs Jobs, ScriptedWorker Worker) Build(int blips, TimeSpan retention)
    {
        var worker = new ScriptedWorker(blips);
        var services = new ServiceCollection().AddSingleton<IPackageWorkerClient>(worker).BuildServiceProvider();
        var jobs = new MapPackageJobs(
            services.GetRequiredService<IServiceScopeFactory>(),
            new MapPackageJobOptions(TimeSpan.FromMilliseconds(5), TimeSpan.FromMinutes(1), retention),
            NullLogger<MapPackageJobs>.Instance);
        return (jobs, worker);
    }

    private static async Task<MapPackageJobStatus> SettleAsync(MapPackageJobs jobs, string id)
    {
        for (var i = 0; i < 400; i++)
        {
            var s = jobs.Get(id);
            if (s is { State: "failed" or "registered" }) return s;
            await Task.Delay(5);
        }
        throw new TimeoutException("never settled");
    }

    /// <summary>
    /// A poll that fails in transit is not the job failing. It used to end the job on the first
    /// blip, so a package the worker then finished was never registered.
    /// </summary>
    [Fact]
    public async Task A_failed_poll_is_retried_and_the_jobs_real_outcome_is_reported()
    {
        var (jobs, worker) = Build(blips: 3, retention: TimeSpan.FromHours(1));
        await jobs.StartAsync(new PackageWorkerRequest([1, 2, 3, 4], 1, 2, "a.pmtiles"), key: null);

        var done = await SettleAsync(jobs, "job-1");

        Assert.Equal("failed", done.State);
        Assert.Equal("the worker's own reason", done.Error);
        Assert.Equal(4, worker.Polls);
    }

    [Fact]
    public async Task A_finished_job_is_forgotten_after_the_retention()
    {
        var (jobs, _) = Build(blips: 0, retention: TimeSpan.FromMilliseconds(50));
        await jobs.StartAsync(new PackageWorkerRequest([1, 2, 3, 4], 1, 2, "a.pmtiles"), key: null);
        await SettleAsync(jobs, "job-1");

        await Task.Delay(120);

        Assert.Null(jobs.Get("job-1"));
    }
}
