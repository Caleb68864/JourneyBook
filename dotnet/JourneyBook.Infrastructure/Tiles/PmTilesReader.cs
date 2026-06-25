using System.Buffers.Binary;
using System.IO.Compression;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Minimal PMTiles v3 reader. Parses the 127-byte header, walks the (optionally gzip-compressed)
/// root + leaf directories, maps a <c>(z,x,y)</c> to a Hilbert tile id, and returns the tile bytes
/// from the data section. Operates on any seekable <see cref="Stream"/> (a local <c>FileStream</c>
/// or an HTTP range stream), reading only the byte ranges it needs. Returns <c>null</c> when the
/// tile is absent (sparse archive). No external dependency — the spec prefers a hand-rolled reader.
/// </summary>
public sealed class PmTilesReader
{
    private const int HeaderLength = 127;
    private static readonly byte[] Magic = "PMTiles"u8.ToArray();

    /// <summary>Header <c>tile_type</c> byte: 1=mvt, 2=png, 3=jpeg, 4=webp, 5=avif.</summary>
    public async Task<byte> ReadTileTypeAsync(Stream archive, CancellationToken ct)
    {
        var header = await ReadRangeAsync(archive, 0, HeaderLength, ct);
        ValidateMagic(header);
        return header[99];
    }

    public async Task<byte[]?> ReadTileAsync(Stream archive, int z, int x, int y, CancellationToken ct)
    {
        var header = await ReadRangeAsync(archive, 0, HeaderLength, ct);
        ValidateMagic(header);

        var rootDirOffset = (long)BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(8, 8));
        var rootDirLength = (long)BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(16, 8));
        var leafDirOffset = (long)BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(40, 8));
        var tileDataOffset = (long)BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(56, 8));
        var internalCompression = header[97];
        var tileCompression = header[98];

        var tileId = ZxyToTileId(z, x, y);

        var dirBytes = Decompress(await ReadRangeAsync(archive, rootDirOffset, rootDirLength, ct), internalCompression);
        var entries = ParseDirectory(dirBytes);

        // Up to a few directory levels (root → leaf → leaf). Bounded to avoid a malformed cycle.
        for (var depth = 0; depth < 4; depth++)
        {
            var idx = FindEntry(entries, tileId);
            if (idx < 0)
            {
                return null;
            }

            var entry = entries[idx];
            if (entry.RunLength == 0)
            {
                // Leaf directory pointer.
                var leafBytes = Decompress(await ReadRangeAsync(archive, leafDirOffset + (long)entry.Offset, entry.Length, ct), internalCompression);
                entries = ParseDirectory(leafBytes);
                continue;
            }

            if (tileId - entry.TileId < entry.RunLength)
            {
                var raw = await ReadRangeAsync(archive, tileDataOffset + (long)entry.Offset, entry.Length, ct);
                return Decompress(raw, tileCompression);
            }

            return null;
        }

        return null;
    }

    private static void ValidateMagic(byte[] header)
    {
        if (header.Length < HeaderLength || !header.AsSpan(0, 7).SequenceEqual(Magic) || header[7] != 3)
        {
            throw new InvalidDataException("Not a PMTiles v3 archive.");
        }
    }

    private static byte[] Decompress(byte[] data, byte compression)
    {
        // 1 = none, 2 = gzip. Other algorithms are not used by our archives.
        if (compression != 2)
        {
            return data;
        }

        using var input = new MemoryStream(data);
        using var gz = new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        gz.CopyTo(output);
        return output.ToArray();
    }

    private static async Task<byte[]> ReadRangeAsync(Stream s, long offset, long length, CancellationToken ct)
    {
        s.Seek(offset, SeekOrigin.Begin);
        var buffer = new byte[length];
        var read = 0;
        while (read < length)
        {
            var n = await s.ReadAsync(buffer.AsMemory(read, (int)(length - read)), ct);
            if (n == 0) break;
            read += n;
        }
        if (read != length)
        {
            throw new InvalidDataException("Unexpected end of PMTiles archive.");
        }
        return buffer;
    }

    private readonly record struct Entry(ulong TileId, ulong Offset, uint Length, uint RunLength);

    private static Entry[] ParseDirectory(byte[] buf)
    {
        var pos = 0;
        var count = (int)ReadVarint(buf, ref pos);
        var entries = new Entry[count];

        ulong lastId = 0;
        var ids = new ulong[count];
        for (var i = 0; i < count; i++)
        {
            lastId += ReadVarint(buf, ref pos);
            ids[i] = lastId;
        }

        var runLengths = new uint[count];
        for (var i = 0; i < count; i++) runLengths[i] = (uint)ReadVarint(buf, ref pos);

        var lengths = new uint[count];
        for (var i = 0; i < count; i++) lengths[i] = (uint)ReadVarint(buf, ref pos);

        var offsets = new ulong[count];
        for (var i = 0; i < count; i++)
        {
            var raw = ReadVarint(buf, ref pos);
            offsets[i] = raw == 0
                ? (i == 0 ? 0 : offsets[i - 1] + lengths[i - 1])
                : raw - 1;
        }

        for (var i = 0; i < count; i++)
        {
            entries[i] = new Entry(ids[i], offsets[i], lengths[i], runLengths[i]);
        }
        return entries;
    }

    /// <summary>Largest entry whose TileId ≤ target (entries are sorted ascending), or -1.</summary>
    private static int FindEntry(Entry[] entries, ulong target)
    {
        var lo = 0;
        var hi = entries.Length - 1;
        var result = -1;
        while (lo <= hi)
        {
            var mid = (lo + hi) / 2;
            if (entries[mid].TileId <= target)
            {
                result = mid;
                lo = mid + 1;
            }
            else
            {
                hi = mid - 1;
            }
        }
        return result;
    }

    private static ulong ReadVarint(byte[] buf, ref int pos)
    {
        ulong result = 0;
        var shift = 0;
        while (true)
        {
            var b = buf[pos++];
            result |= (ulong)(b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return result;
    }

    /// <summary>
    /// PMTiles tile id: the per-zoom base offset (sum of 4^i for i&lt;z) plus the Hilbert-curve
    /// index of (x,y) within the 2^z grid.
    /// </summary>
    public static ulong ZxyToTileId(int z, int x, int y)
    {
        ulong acc = 0;
        for (var t = 0; t < z; t++)
        {
            acc += (ulong)(1L << (2 * t)); // 4^t
        }
        return acc + HilbertXyToD(z, x, y);
    }

    private static ulong HilbertXyToD(int z, int x, int y)
    {
        ulong d = 0;
        long n = 1L << z;
        for (long s = n / 2; s > 0; s /= 2)
        {
            var rx = (x & s) > 0 ? 1 : 0;
            var ry = (y & s) > 0 ? 1 : 0;
            d += (ulong)(s * s) * (ulong)((3 * rx) ^ ry);

            // Rotate the quadrant.
            if (ry == 0)
            {
                if (rx == 1)
                {
                    x = (int)(s - 1 - x);
                    y = (int)(s - 1 - y);
                }
                (x, y) = (y, x);
            }
        }
        return d;
    }
}
