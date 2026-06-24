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

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
    {
        if (buffer.IsEmpty) return 0;

        using var req = new HttpRequestMessage(HttpMethod.Get, url)
        {
            Headers = { Range = new RangeHeaderValue(_position, _position + buffer.Length - 1) },
        };
        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new IOException($"Range request failed: {(int)res.StatusCode}");
        }

        var bytes = await res.Content.ReadAsByteArrayAsync(ct);
        var n = Math.Min(bytes.Length, buffer.Length);
        bytes.AsSpan(0, n).CopyTo(buffer.Span);
        _position += n;
        return n;
    }

    public override int Read(byte[] buffer, int offset, int count) =>
        ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
