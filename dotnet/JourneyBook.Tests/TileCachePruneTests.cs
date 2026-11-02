using System.Text.Json;
using JourneyBook.Infrastructure.Tiles;
using Microsoft.Extensions.Logging.Abstractions;

namespace JourneyBook.Tests;

/// <summary>
/// The .NET half of the prune conformance suite. <c>tilecache.test.ts</c> reads the same
/// fixture, because the worker and the API can own one cache directory.
/// </summary>
public sealed class TileCachePruneTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "jb-prune-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private sealed record FixtureFile(string Path, int Size, double AgeHours);

    private sealed record FixtureCase(string Id, long MaxBytes, FixtureFile[] Files, string[] Kept);

    private sealed record Fixture(FixtureCase[] Cases);

    private static Fixture LoadFixture()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "data", "fixtures", "tile-cache-prune.json")))
        {
            dir = dir.Parent;
        }

        var text = File.ReadAllText(Path.Combine(dir!.FullName, "data", "fixtures", "tile-cache-prune.json"));
        return JsonSerializer.Deserialize<Fixture>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    }

    public static TheoryData<string> CaseIds()
    {
        var ids = new TheoryData<string>();
        foreach (var c in LoadFixture().Cases)
        {
            ids.Add(c.Id);
        }

        return ids;
    }

    private void Write(string relative, int size, DateTime lastWriteUtc)
    {
        var file = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllBytes(file, new byte[size]);
        File.SetLastWriteTimeUtc(file, lastWriteUtc);
    }

    private string[] ListFiles() =>
        Directory.Exists(_root)
            ? Directory.EnumerateFiles(_root, "*", SearchOption.AllDirectories)
                .Select(f => Path.GetRelativePath(_root, f).Replace('\\', '/'))
                .Order(StringComparer.Ordinal)
                .ToArray()
            : [];

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void Matches_the_shared_fixture(string caseId)
    {
        var c = LoadFixture().Cases.Single(x => x.Id == caseId);
        var now = DateTime.UtcNow;
        foreach (var f in c.Files)
        {
            Write(f.Path, f.Size, now.AddHours(-f.AgeHours));
        }

        new TileCache(_root).Prune(c.MaxBytes, now);

        Assert.Equal(c.Kept.Order(StringComparer.Ordinal), ListFiles());
    }

    [Fact]
    public void Reports_what_it_did_and_removes_directories_it_emptied()
    {
        var now = DateTime.UtcNow;
        Write("usgs/16/1/1.png", 100, now.AddHours(-2));
        Write("usgs/15/2/1.png", 100, now);

        var result = new TileCache(_root).Prune(100, now);

        Assert.Equal(new TileCachePruneResult(1, 0, 100), result);
        Assert.False(Directory.Exists(Path.Combine(_root, "usgs", "16")));
        Assert.True(new TileCache(_root).TryGet("usgs", 15, 2, 1, out _, out _));
    }

    [Fact]
    public void A_missing_cache_directory_is_an_empty_one()
    {
        Assert.Equal(new TileCachePruneResult(0, 0, 0), new TileCache(_root).Prune(0));
    }

    [Fact]
    public async Task The_service_applies_the_limit_when_one_is_set()
    {
        Write("usgs/16/1/1.png", 2048, DateTime.UtcNow);

        using var service = new TileCachePruneService(
            new TileCache(_root),
            new TileCachePruneOptions(1024, TimeSpan.FromHours(1)),
            NullLogger<TileCachePruneService>.Instance);
        await service.StartAsync(CancellationToken.None);

        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (ListFiles().Length > 0 && DateTime.UtcNow < deadline)
        {
            await Task.Delay(10);
        }

        await service.StopAsync(CancellationToken.None);

        Assert.Empty(ListFiles());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task The_service_deletes_nothing_without_a_limit(long maxBytes)
    {
        Write("usgs/16/1/1.png", 2048, DateTime.UtcNow.AddYears(-1));

        using var service = new TileCachePruneService(
            new TileCache(_root),
            new TileCachePruneOptions(maxBytes, TimeSpan.FromHours(1)),
            NullLogger<TileCachePruneService>.Instance);
        await service.StartAsync(CancellationToken.None);
        await service.ExecuteTask!;
        await service.StopAsync(CancellationToken.None);

        Assert.Single(ListFiles());
    }
}
