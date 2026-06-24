using JourneyBook.Infrastructure.Tiles;
using JourneyBook.Tests.Api;

namespace JourneyBook.Tests;

public class PmTilesReaderTests
{
    private readonly PmTilesReader _reader = new();

    [Fact]
    public async Task Reads_present_tile_bytes()
    {
        using var stream = new MemoryStream(PmTilesFixture.Build());
        var bytes = await _reader.ReadTileAsync(stream, PmTilesFixture.Z, PmTilesFixture.X, PmTilesFixture.Y, CancellationToken.None);

        Assert.NotNull(bytes);
        Assert.Equal(PmTilesFixture.TilePayload, bytes);
    }

    [Fact]
    public async Task Absent_tile_returns_null()
    {
        using var stream = new MemoryStream(PmTilesFixture.Build());
        var bytes = await _reader.ReadTileAsync(stream, PmTilesFixture.Z, PmTilesFixture.AbsentX, PmTilesFixture.AbsentY, CancellationToken.None);

        Assert.Null(bytes);
    }

    [Fact]
    public async Task Reads_tile_type_png()
    {
        using var stream = new MemoryStream(PmTilesFixture.Build());
        var type = await _reader.ReadTileTypeAsync(stream, CancellationToken.None);

        Assert.Equal(2, type); // 2 = png
    }

    [Theory]
    [InlineData(0, 0, 0, 0UL)]
    [InlineData(1, 0, 0, 1UL)]
    [InlineData(2, 0, 0, 5UL)]
    public void TileId_base_offsets_match_spec(int z, int x, int y, ulong expected)
    {
        Assert.Equal(expected, PmTilesReader.ZxyToTileId(z, x, y));
    }
}
