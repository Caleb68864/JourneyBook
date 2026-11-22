using System.Net.Http.Headers;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Minimal seekable read-only stream over a remote resource via HTTP <c>Range</c> requests. The
/// PMTiles reader only seeks to absolute offsets and reads known-length ranges, so each
/// <see cref="ReadAsync(Memory{byte},CancellationToken)"/> issues one ranged GET. <c>Length</c> is
/// not used by the reader and is intentionally unsupported. Untested by automated tests (the local
/// archive path is the MVP-verified route); provided so a remote <c>http(s)</c> PMTiles row works.
/// </summary>
public sealed class HttpRangeStream(HttpClient http, string url) : Stream
{
    private long _position;

    public override bool CanRead => true;
    public override bool CanSeek => true;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => _position; set => _position = value; }

    public override long Seek(long offset, SeekOrigin origin)
    {
        _position = origin switch
        {
            SeekOrigin.Begin => offset,
            SeekOrigin.Current => _position + offset,
            _ => throw new NotSupportedException("SeekOrigin.End is not supported on a range stream."),
        };
        return _position;
    }

    /// <summary>Largest archive read whole when its host ignores <c>Range</c> (16 MiB).</summary>
    public const long MaxWholeFileBytes = 16 * 1024 * 1024;

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
    {
        if (buffer.IsEmpty) return 0;

        using var req = new HttpRequestMessage(HttpMethod.Get, url)
        {
            Headers = { Range = new RangeHeaderValue(_position, _position + buffer.Length - 1) },
        };
        // Headers first, so a whole-file answer can be refused before its body is buffered.
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (UpstreamThrottle.IsThrottle(res.StatusCode))
        {
            throw new UpstreamThrottledException((int)res.StatusCode, UpstreamThrottle.RetryAfterOf(res, DateTimeOffset.UtcNow));
        }
        if (!res.IsSuccessStatusCode)
        {
            throw new IOException($"Range request failed: {(int)res.StatusCode}");
        }

        // A host that ignores Range sends the whole archive on EVERY read (a tile is four or five
        // reads), so beyond a small archive that is gigabytes per tile, and past 2 GB the buffer
        // throws. Allow it only for a small file; refuse a large one up front.
        if (res.StatusCode == System.Net.HttpStatusCode.OK
            && (res.Content.Headers.ContentLength is not long whole || whole > MaxWholeFileBytes))
        {
            throw new IOException(
                $"The archive's host ignores Range requests and the file is too large to fetch whole on every read " +
                $"(over {MaxWholeFileBytes / (1024 * 1024)} MiB, or of unknown size).");
        }

        var bytes = await res.Content.ReadAsByteArrayAsync(ct);
        // A host that ignores Range answers 200 with the WHOLE file. Its first bytes used to be
        // copied as if they were the bytes at _position, so every read past the header was
        // silently the wrong part of the archive. Take the slice at _position instead.
        var start = 0;
        if (res.StatusCode == System.Net.HttpStatusCode.OK)
        {
            if (_position >= bytes.Length) return 0;
            start = (int)_position;
        }
        var n = Math.Min(bytes.Length - start, buffer.Length);
        bytes.AsSpan(start, n).CopyTo(buffer.Span);
        _position += n;
        return n;
    }

    public override int Read(byte[] buffer, int offset, int count) =>
        ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
