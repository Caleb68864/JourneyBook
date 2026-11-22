using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.Tiles;
using JourneyBook.Tests.Api;

namespace JourneyBook.Tests;

/// <summary>
/// The raster package the TS writer makes (<c>writePmTiles</c>, held byte for byte to
/// <c>data/fixtures/raster-package/package.pmtiles</c> by <c>packages/render-cli/src/package.test.ts</c>)
/// read back with the C# <see cref="PmTilesReader"/>. The fixture forces leaf directories and
/// holds a run of identical tiles, so the reader's leaf and run-length paths are both exercised.
/// </summary>
public class RasterPackageFixtureTests
{
    internal sealed record TileRef(int Z, int X, int Y, string? Sha256);
    internal sealed record Manifest(int TileType, int MinZoom, int MaxZoom, List<TileRef> Tiles, List<TileRef> Absent);

    internal static string FixtureDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "data", "fixtures", "raster-package");
            if (File.Exists(Path.Combine(candidate, "package.pmtiles"))) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException("data/fixtures/raster-package/package.pmtiles not found walking up from " + AppContext.BaseDirectory);
    }

    internal static Manifest LoadManifest()
    {
        var m = JsonSerializer.Deserialize<Manifest>(
            File.ReadAllText(Path.Combine(FixtureDir(), "manifest.json")),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        if (m.Tiles.Count == 0) throw new InvalidOperationException("raster-package manifest lists no tiles.");
        return m;
    }

    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    [Fact]
    public async Task Every_packaged_tile_reads_back_and_absent_tiles_are_null()
    {
        var manifest = LoadManifest();
        await using var archive = File.OpenRead(Path.Combine(FixtureDir(), "package.pmtiles"));
        var reader = new PmTilesReader();

        Assert.Equal(manifest.TileType, await reader.ReadTileTypeAsync(archive, CancellationToken.None));
        foreach (var t in manifest.Tiles)
        {
            var bytes = await reader.ReadTileAsync(archive, t.Z, t.X, t.Y, CancellationToken.None);
            Assert.True(bytes is not null, $"{t.Z}/{t.X}/{t.Y} missing");
            Assert.Equal(t.Sha256, Sha(bytes!));
        }
        foreach (var a in manifest.Absent)
        {
            Assert.Null(await reader.ReadTileAsync(archive, a.Z, a.X, a.Y, CancellationToken.None));
        }
    }

    /// <summary>
    /// A corrupt header claiming a huge metadata block is an unreadable archive
    /// (<see cref="InvalidDataException"/>, which registration answers as 400), not an attempt to
    /// allocate it (an OverflowException, which surfaced as a 500).
    /// </summary>
    [Fact]
    public async Task A_header_claiming_impossible_metadata_is_unreadable_not_a_crash()
    {
        var bytes = await File.ReadAllBytesAsync(Path.Combine(FixtureDir(), "package.pmtiles"));
        BitConverter.GetBytes(ulong.MaxValue / 2).CopyTo(bytes, 32);
        await using var archive = new MemoryStream(bytes);

        await Assert.ThrowsAsync<InvalidDataException>(() => new PmTilesReader().ReadMetadataAsync(archive, CancellationToken.None));
    }
}
