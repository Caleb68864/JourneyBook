using System.Net;
using System.Net.Sockets;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Decides where the tile fetchers are allowed to make outbound requests.
///
/// <para>
/// <b>The hole this closes.</b> <c>POST /api/tile-sources</c> stored any
/// <c>SourceUrl</c>, and <c>GET /api/tiles/{source}/{z}/{x}/{y}</c> then made the
/// server fetch it and returned the body to the caller. That is a full SSRF with
/// response reflection: point a source at <c>http://169.254.169.254/…</c> and the
/// API reads cloud instance metadata for you; point it at an internal host and it
/// is a port scanner that answers 200/502.
/// </para>
///
/// <para>
/// <b>Why the check is on the IP and not the hostname.</b> Validating the URL at
/// registration only proves what the name resolved to <i>then</i>. An attacker
/// controls their own DNS, so a name that answers a public address during
/// validation can answer <c>127.0.0.1</c> a second later (DNS rebinding), and a
/// public URL can 302 to a private one. So the real enforcement is
/// <see cref="IsBlockedAddress"/>, called from a <c>SocketsHttpHandler</c>
/// connect callback: it runs against the actual address being connected to, on
/// every connection, including every redirect hop. Registration-time validation
/// is kept as well, but only to give a human a clear error instead of a silent
/// 502 later.
/// </para>
/// </summary>
public sealed class TileEgressPolicy
{
    /// <summary>Schemes a tile source may use. Anything else (file, gopher, ftp) is refused.</summary>
    private static readonly string[] DefaultSchemes = ["https", "http"];

    private readonly HashSet<string> allowedHosts;
    private readonly bool allowPrivateNetworks;
    private readonly string[] allowedSchemes;

    /// <param name="allowedHosts">
    /// When non-empty, an allowlist: only these hosts may be fetched, which is the
    /// strongest configuration and the one a deployment should use. When empty the
    /// policy falls back to denying private/link-local/loopback ranges, so an
    /// operator who has not curated a list is still not exposing their metadata
    /// service.
    /// </param>
    /// <param name="allowPrivateNetworks">
    /// Escape hatch for a developer running a tile server on localhost. Defaults to
    /// false; turning it on re-opens the SSRF and is documented as doing so.
    /// </param>
    public TileEgressPolicy(
        IEnumerable<string>? allowedHosts = null,
        bool allowPrivateNetworks = false,
        IEnumerable<string>? allowedSchemes = null)
    {
        this.allowedHosts = new HashSet<string>(
            allowedHosts ?? [], StringComparer.OrdinalIgnoreCase);
        this.allowPrivateNetworks = allowPrivateNetworks;
        this.allowedSchemes = (allowedSchemes ?? DefaultSchemes).ToArray();
    }

    /// <summary>Is an explicit host allowlist configured?</summary>
    public bool HasHostAllowlist => allowedHosts.Count > 0;

    /// <summary>
    /// Validate a stored <c>SourceUrl</c> template at registration time. Returns
    /// false with a reason the caller can show the user. The <c>{z}/{x}/{y}</c>
    /// tokens are replaced with digits first so the template parses as a URI.
    /// </summary>
    /// <param name="kind">
    /// The source's <c>Kind</c>. A <c>pmtiles</c> source is allowed to name a local
    /// archive instead of a URL — <c>PmTilesFetcher</c> resolves those inside the
    /// configured <c>TileCache:PmTilesDir</c> root and refuses anything that
    /// escapes it, so a local path is governed by that path-confinement guard
    /// rather than by this network policy. Applying the URL rules to them would
    /// reject every local map package and break the feature outright.
    /// </param>
    public bool TryValidateTemplate(string? urlTemplate, string? kind, out string reason)
    {
        reason = "";
        if (string.IsNullOrWhiteSpace(urlTemplate))
        {
            reason = "Tile source URL is required.";
            return false;
        }

        var isPmTiles = string.Equals(kind, "pmtiles", StringComparison.OrdinalIgnoreCase);
        var probe = urlTemplate.Replace("{z}", "1").Replace("{x}", "1").Replace("{y}", "1");

        if (!Uri.TryCreate(probe, UriKind.Absolute, out var uri))
        {
            // Not a URL at all. Only a local PMTiles archive may look like this.
            if (isPmTiles) return true;
            reason = "Tile source URL must be an absolute URL.";
            return false;
        }

        // file:// is a local archive, not egress; PmTilesFetcher confines it.
        if (uri.IsFile)
        {
            if (isPmTiles) return true;
            reason = "Only a pmtiles source may reference a local file.";
            return false;
        }

        if (!allowedSchemes.Contains(uri.Scheme, StringComparer.OrdinalIgnoreCase))
        {
            reason = $"Tile source URL scheme '{uri.Scheme}' is not allowed (allowed: {string.Join(", ", allowedSchemes)}).";
            return false;
        }

        if (HasHostAllowlist && !allowedHosts.Contains(uri.Host))
        {
            reason = $"Tile source host '{uri.Host}' is not on the allowed list.";
            return false;
        }

        // A literal IP in the URL can be judged right now with no DNS involved, so
        // reject the obvious attempt immediately rather than at connect time.
        if (IPAddress.TryParse(uri.Host, out var literal) && IsBlockedAddress(literal))
        {
            reason = $"Tile source host '{uri.Host}' is a private, loopback or link-local address.";
            return false;
        }

        return true;
    }

    /// <summary>
    /// Is this address one the server must never be talked into connecting to?
    /// Called per TCP connection, so it also covers DNS rebinding and redirects.
    /// </summary>
    public bool IsBlockedAddress(IPAddress address)
    {
        if (allowPrivateNetworks) return false;

        // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) is the same machine as the
        // IPv4 it wraps; judge it as the IPv4 or the mapping is a trivial bypass.
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();

        if (IPAddress.IsLoopback(address)) return true;

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            return b[0] switch
            {
                0 => true,                                   // 0.0.0.0/8 "this network"
                10 => true,                                  // 10/8 private
                127 => true,                                 // loopback (also caught above)
                >= 224 => true,                              // 224/4 multicast + 240/4 reserved
                100 => b[1] >= 64 && b[1] <= 127,            // 100.64/10 carrier-grade NAT
                169 => b[1] == 254,                          // 169.254/16 link-local — cloud metadata
                172 => b[1] >= 16 && b[1] <= 31,             // 172.16/12 private
                192 => (b[1] == 168) || (b[1] == 0 && b[2] == 0), // 192.168/16, 192.0.0/24
                198 => b[1] is 18 or 19,                     // 198.18/15 benchmarking
                _ => false,
            };
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast) return true;
            var b = address.GetAddressBytes();
            if ((b[0] & 0xFE) == 0xFC) return true;          // fc00::/7 unique local
            if (address.Equals(IPAddress.IPv6Any)) return true;
            return false;
        }

        // Anything that is not IPv4 or IPv6 has no business being a tile host.
        return true;
    }
}
