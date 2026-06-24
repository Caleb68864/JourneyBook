using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests.Api;

/// <summary>
/// Builds a deterministic, minimal valid PMTiles v3 archive in memory: one root directory entry
/// for a single known tile, no leaf dirs, no compression, tile_type = png. Used to prove the
/// reader/fetcher round-trip without committing a binary blob or hitting the network.
/// </summary>
public static class PmTilesFixture
{
    public const int Z = 2;
    public const int X = 1;
    public const int Y = 1;

    /// <summary>A coordinate guaranteed NOT in the archive (different tile id) → sparse miss.</summary>
    public const int AbsentX = 0;
    public const int AbsentY = 0;

    public static readonly byte[] TilePayload = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 42, 7];

    public static byte[] Build()
    {
        var tileId = PmTilesReader.ZxyToTileId(Z, X, Y);

        var dir = new List<byte>();
        WriteVarint(dir, 1);                          // entry count
        WriteVarint(dir, tileId);                     // tile id (delta from 0 == absolute)
        WriteVarint(dir, 1);                          // run length
        WriteVarint(dir, (ulong)TilePayload.Length);  // length
        WriteVarint(dir, 1);                          // offset sentinel 1 => offset 0
        var dirBytes = dir.ToArray();

        long rootDirOffset = 127;
        long rootDirLength = dirBytes.Length;
        long metadataOffset = rootDirOffset + rootDirLength;
        long leafDirOffset = metadataOffset; // length 0
        long tileDataOffset = metadataOffset; // metadata length 0
        long tileDataLength = TilePayload.Length;

        var header = new byte[127];
        "PMTiles"u8.ToArray().CopyTo(header, 0);
        header[7] = 3;
        WriteUInt64LE(header, 8, (ulong)rootDirOffset);
        WriteUInt64LE(header, 16, (ulong)rootDirLength);
        WriteUInt64LE(header, 24, (ulong)metadataOffset);
        WriteUInt64LE(header, 32, 0);                 // metadata length
        WriteUInt64LE(header, 40, (ulong)leafDirOffset);
        WriteUInt64LE(header, 48, 0);                 // leaf dirs length
        WriteUInt64LE(header, 56, (ulong)tileDataOffset);
        WriteUInt64LE(header, 64, (ulong)tileDataLength);
        WriteUInt64LE(header, 72, 1);                 // addressed tiles
        WriteUInt64LE(header, 80, 1);                 // tile entries
        WriteUInt64LE(header, 88, 1);                 // tile contents
        header[96] = 1;                               // clustered
        header[97] = 1;                               // internal compression: none
        header[98] = 1;                               // tile compression: none
        header[99] = 2;                               // tile type: png
        header[100] = Z;                              // min zoom
        header[101] = Z;                              // max zoom

        var archive = new byte[tileDataOffset + tileDataLength];
        header.CopyTo(archive, 0);
        dirBytes.CopyTo(archive, (int)rootDirOffset);
        TilePayload.CopyTo(archive, (int)tileDataOffset);
        return archive;
    }

    /// <summary>Writes the fixture archive to a file and returns its path.</summary>
    public static string WriteTo(string directory, string fileName = "fixture.pmtiles")
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, fileName);
        File.WriteAllBytes(path, Build());
        return path;
    }

    private static void WriteVarint(List<byte> buf, ulong value)
    {
        while (value >= 0x80)
        {
            buf.Add((byte)(value | 0x80));
            value >>= 7;
        }
        buf.Add((byte)value);
    }

    private static void WriteUInt64LE(byte[] buf, int offset, ulong value)
    {
        for (var i = 0; i < 8; i++)
        {
            buf[offset + i] = (byte)(value >> (8 * i));
        }
    }
}
