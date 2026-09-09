using System.Net;
using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests;

/// <summary>
/// The tile registry stored any URL and the proxy fetched it and returned the
/// body — a full SSRF with response reflection. These cover the policy that
/// decides where the fetchers may connect.
/// </summary>
public class TileEgressPolicyTests
{
    private static readonly TileEgressPolicy Default = new();

    // --- The addresses that matter ---------------------------------------

    [Theory]
    // The cloud metadata service: the single highest-value SSRF target, since it
    // hands out instance credentials to anything that can make it a GET.
    [InlineData("169.254.169.254")]
    [InlineData("169.254.0.1")]
    [InlineData("127.0.0.1")]
    [InlineData("127.1.2.3")]
    [InlineData("0.0.0.0")]
    [InlineData("10.0.0.5")]
    [InlineData("172.16.0.1")]
    [InlineData("172.31.255.254")]
    [InlineData("192.168.1.1")]
    [InlineData("192.0.0.1")]
    [InlineData("100.64.0.1")]   // carrier-grade NAT
    [InlineData("198.18.0.1")]   // benchmarking range
    [InlineData("224.0.0.1")]    // multicast
    [InlineData("255.255.255.255")]
    [InlineData("::1")]          // IPv6 loopback
    [InlineData("fe80::1")]      // IPv6 link-local
    [InlineData("fc00::1")]      // IPv6 unique-local
    [InlineData("::ffff:127.0.0.1")]   // IPv4-mapped loopback — the cheap bypass
    [InlineData("::ffff:169.254.169.254")]
    public void Blocks_private_loopback_and_link_local(string ip)
    {
        Assert.True(Default.IsBlockedAddress(IPAddress.Parse(ip)), $"{ip} should be blocked");
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("1.1.1.1")]
    [InlineData("52.10.20.30")]
    [InlineData("172.32.0.1")]   // just outside 172.16/12
    [InlineData("172.15.255.255")]
    [InlineData("100.63.255.255")] // just outside 100.64/10
    [InlineData("100.128.0.1")]
    [InlineData("192.1.0.1")]
    [InlineData("2606:4700::1111")]
    public void Allows_ordinary_public_addresses(string ip)
    {
        Assert.False(Default.IsBlockedAddress(IPAddress.Parse(ip)), $"{ip} should be allowed");
    }

    [Fact]
    public void Private_networks_can_be_re_enabled_for_local_development()
    {
        var permissive = new TileEgressPolicy(allowPrivateNetworks: true);
        Assert.False(permissive.IsBlockedAddress(IPAddress.Loopback));
    }

    // --- Registration-time template validation ----------------------------

    [Fact]
    public void Accepts_an_ordinary_https_tile_template()
    {
        Assert.True(Default.TryValidateTemplate(
            "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
            "usgs-raster", out _));
    }

    [Theory]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("https://127.0.0.1/tiles/{z}/{x}/{y}")]
    [InlineData("http://[::1]/tiles/{z}/{x}/{y}")]
    [InlineData("https://10.0.0.5/tiles/{z}/{x}/{y}")]
    public void Rejects_a_literal_private_address_in_the_template(string url)
    {
        Assert.False(Default.TryValidateTemplate(url, "xyz-server", out var reason));
        Assert.NotEmpty(reason);
    }

    [Theory]
    [InlineData("gopher://example.com/tiles")]
    [InlineData("ftp://example.com/tiles")]
    public void Rejects_schemes_that_are_not_http_or_https(string url)
    {
        Assert.False(Default.TryValidateTemplate(url, "xyz-server", out _));
    }

    [Fact]
    public void Rejects_a_file_url_for_a_raster_source()
    {
        // file:///etc/passwd through the raster fetcher would be an arbitrary read.
        Assert.False(Default.TryValidateTemplate("file:///etc/passwd", "xyz-server", out _));
    }

    [Fact]
    public void Rejects_a_non_absolute_url_for_a_raster_source()
    {
        Assert.False(Default.TryValidateTemplate("/etc/passwd", "xyz-server", out _));
    }

    // A pmtiles source may name a local archive; PmTilesFetcher confines those
    // under TileCache:PmTilesDir, so the network policy must not reject them or
    // every local map package stops working.
    [Theory]
    [InlineData("fixture.pmtiles")]
    [InlineData("file:///data/map-packages/region.pmtiles")]
    public void Allows_a_local_archive_for_a_pmtiles_source(string url)
    {
        Assert.True(Default.TryValidateTemplate(url, "pmtiles", out _));
    }

    [Fact]
    public void A_remote_pmtiles_archive_is_still_subject_to_the_address_policy()
    {
        Assert.False(Default.TryValidateTemplate("http://169.254.169.254/a.pmtiles", "pmtiles", out _));
    }

    // --- Host allowlist ---------------------------------------------------

    [Fact]
    public void An_allowlist_rejects_every_host_not_on_it()
    {
        var policy = new TileEgressPolicy(allowedHosts: ["basemap.nationalmap.gov"]);

        Assert.True(policy.HasHostAllowlist);
        Assert.True(policy.TryValidateTemplate("https://basemap.nationalmap.gov/x/{z}/{x}/{y}", "usgs-raster", out _));
        Assert.False(policy.TryValidateTemplate("https://evil.example.com/x/{z}/{x}/{y}", "usgs-raster", out var reason));
        Assert.Contains("not on the allowed list", reason);
    }

    [Fact]
    public void Empty_url_is_rejected()
    {
        Assert.False(Default.TryValidateTemplate("", "xyz-server", out _));
        Assert.False(Default.TryValidateTemplate(null, "xyz-server", out _));
    }
}
