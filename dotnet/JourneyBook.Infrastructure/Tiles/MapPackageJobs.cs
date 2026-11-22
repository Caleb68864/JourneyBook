using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>What the API asks the render worker's <c>POST /package</c> for.</summary>
public sealed record PackageWorkerRequest(
    double[] Bbox,
    int MinZoom,
    int MaxZoom,
    string OutputName,
    string? TileBaseUrl = null,
    string? TileSourceId = null,
    int? MaxTiles = null);

/// <summary>The worker's package job record (<c>services/render-worker/src/package-route.ts</c>).</summary>
public sealed record PackageWorkerJob(
    string Id,
    string State,
    string OutputName,
    long? Tiles = null,
    long? Bytes = null,
    string? TileType = null,
    string? Error = null);

/// <summary>The worker refused the request; <see cref="Status"/> is its HTTP status (400, 409, 503).</summary>
public sealed class PackageWorkerRefusedException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>Talks to the render worker's package job routes. The worker owns tile enumeration (ADR 0004).</summary>
public interface IPackageWorkerClient
{
    Task<PackageWorkerJob> StartAsync(PackageWorkerRequest request, CancellationToken ct = default);

    /// <summary>The job, or null when the worker no longer knows it (restarted, or retention passed).</summary>
    Task<PackageWorkerJob?> GetAsync(string id, CancellationToken ct = default);
}

public sealed class HttpPackageWorkerClient(HttpClient http) : IPackageWorkerClient
{
    private static readonly JsonSerializerOptions s_json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task<PackageWorkerJob> StartAsync(PackageWorkerRequest request, CancellationToken ct = default)
    {
        using var res = await http.PostAsJsonAsync("/package", request, s_json, ct);
        if (res.StatusCode != HttpStatusCode.Accepted)
        {
            var error = await ErrorOf(res, ct);
            throw new PackageWorkerRefusedException((int)res.StatusCode, error);
        }
        return (await res.Content.ReadFromJsonAsync<PackageWorkerJob>(s_json, ct))!;
    }

    public async Task<PackageWorkerJob?> GetAsync(string id, CancellationToken ct = default)
    {
        using var res = await http.GetAsync($"/package-jobs/{Uri.EscapeDataString(id)}", ct);
        if (res.StatusCode == HttpStatusCode.NotFound) return null;
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<PackageWorkerJob>(s_json, ct);
    }

    private static async Task<string> ErrorOf(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String) return e.GetString()!;
        }
        catch (JsonException)
        {
        }
        return $"The render worker answered {(int)res.StatusCode}.";
    }
}

/// <summary>A package the API asked for, as <c>GET /api/map-packages/jobs/{id}</c> reports it.</summary>
/// <param name="State"><c>packaging</c>, <c>registering</c>, <c>registered</c> or <c>failed</c>.</param>
public sealed record MapPackageJobStatus(
    string Id,
    string State,
    string File,
    string? Key,
    long? Tiles = null,
    long? Bytes = null,
    string? TileSourceKey = null,
    string? Error = null);

/// <summary>How often the API asks the worker about a package in progress. Seam for tests.</summary>
/// <param name="FinishedRetention">How long a finished job stays readable (like the worker's own hour).</param>
public sealed record MapPackageJobOptions(TimeSpan PollInterval, TimeSpan GiveUpAfter, TimeSpan FinishedRetention = default)
{
    public TimeSpan Retention => FinishedRetention > TimeSpan.Zero ? FinishedRetention : TimeSpan.FromHours(1);
}

/// <summary>
/// Packages the API has started, and the work of finishing them: wait for the worker, then
/// register the archive as a tile source (<see cref="MapPackageManifest.RegisterAsync"/>). In memory:
/// a restart forgets the job, not the package; a package that finished unregistered is still
/// in the manifest and can be registered by hand.
/// </summary>
public sealed class MapPackageJobs(
    IServiceScopeFactory scopes,
    MapPackageJobOptions options,
    ILogger<MapPackageJobs> logger)
{
    private readonly ConcurrentDictionary<string, MapPackageJobStatus> _jobs = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _finishedAt = new();

    public MapPackageJobStatus? Get(string id)
    {
        Sweep();
        return _jobs.TryGetValue(id, out var s) ? s : null;
    }

    /// <summary>Forget jobs finished longer ago than the retention; the dictionary used to grow for the life of the process.</summary>
    private void Sweep()
    {
        var cutoff = DateTimeOffset.UtcNow - options.Retention;
        foreach (var (id, at) in _finishedAt)
        {
            if (at <= cutoff && _finishedAt.TryRemove(id, out _)) _jobs.TryRemove(id, out _);
        }
    }

    private void Finish(MapPackageJobStatus status)
    {
        _jobs[status.Id] = status;
        _finishedAt[status.Id] = DateTimeOffset.UtcNow;
    }

    /// <summary>Ask the worker for a package and track it to registration. Worker refusals throw.</summary>
    public async Task<MapPackageJobStatus> StartAsync(PackageWorkerRequest request, string? key, CancellationToken ct = default)
    {
        PackageWorkerJob job;
        using (var scope = scopes.CreateScope())
        {
            job = await scope.ServiceProvider.GetRequiredService<IPackageWorkerClient>().StartAsync(request, ct);
        }
        var status = new MapPackageJobStatus(job.Id, "packaging", request.OutputName, key);
        _jobs[job.Id] = status;
        _ = Task.Run(() => FollowAsync(status));
        return status;
    }

    private async Task FollowAsync(MapPackageJobStatus status)
    {
        var deadline = DateTimeOffset.UtcNow + options.GiveUpAfter;
        try
        {
            while (true)
            {
                await Task.Delay(options.PollInterval);
                if (DateTimeOffset.UtcNow > deadline)
                {
                    Finish(status with { State = "failed", Error = "Stopped waiting for the package; it may still finish, and then appears in the manifest unregistered." });
                    return;
                }

                PackageWorkerJob? job;
                try
                {
                    using var scope = scopes.CreateScope();
                    job = await scope.ServiceProvider.GetRequiredService<IPackageWorkerClient>().GetAsync(status.Id);
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
                {
                    // A blip (the worker busy, a slow answer, a dropped connection) during a run
                    // that can take hours. It used to end the job as failed, so a package the
                    // worker went on to write was never registered. Keep asking until the deadline.
                    logger.LogWarning(ex, "Polling package job {JobId} failed; will ask again.", status.Id);
                    continue;
                }

                if (job is null)
                {
                    Finish(status with { State = "failed", Error = "The render worker no longer knows this package job (it may have restarted)." });
                    return;
                }
                if (job.State == "failed")
                {
                    Finish(status with { State = "failed", Error = job.Error ?? "The package failed." });
                    return;
                }
                if (job.State == "completed")
                {
                    var made = status with { State = "registering", Tiles = job.Tiles, Bytes = job.Bytes };
                    _jobs[status.Id] = made;
                    using var scope = scopes.CreateScope();
                    try
                    {
                        var row = await scope.ServiceProvider.GetRequiredService<MapPackageManifest>().RegisterAsync(job.OutputName, status.Key);
                        Finish(made with { State = "registered", TileSourceKey = row.Key });
                    }
                    catch (MapPackageRegistrationException ex)
                    {
                        Finish(made with { State = "failed", Error = $"The package was written but could not be registered: {ex.Message}" });
                    }
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            // Background work: nothing above us would observe this.
            logger.LogError(ex, "Following package job {JobId} failed", status.Id);
            Finish(status with { State = "failed", Error = ex.Message });
        }
    }
}
