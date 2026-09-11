import { describe, it, expect } from "vitest";
import { tileBaseUrlError, parseTileBaseUrlAllowlist } from "./tile-url.js";

/**
 * `tileBaseUrl` is the one render input that makes the process fetch from a
 * destination the input chose. It used to be guarded by `/^https?:\/\//i` and
 * nothing else.
 *
 * Every describe block below pairs refusals with an ACCEPTANCE control, because
 * the failure mode of this kind of guard is not "it let something through" —
 * it is "it refused the one destination the product actually uses", and every
 * negative test stays green while it does.
 */

/** The destination policy the worker applies to an untrusted request body. */
const WORKER = { refuseNonRoutableHosts: true } as const;

describe("tileBaseUrlError — structural rules, applied to every caller", () => {
  it("[CONTROL] accepts the destinations this product actually uses", () => {
    for (const ok of [
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile",
      "http://api:8080/api/tiles",      // the compose deployment's tile proxy
      "http://api:8080/api/tiles/",     // trailing slash, as renderMapPanel tolerates
      "https://tile.openstreetmap.org",
    ]) {
      expect(tileBaseUrlError(ok), ok).toBeNull();
    }
  });

  it("[CONTROL] an absent tileBaseUrl is not an error — the field is optional", () => {
    expect(tileBaseUrlError(undefined)).toBeNull();
  });

  it("refuses a non-http(s) scheme", () => {
    for (const bad of ["file:///etc/passwd", "gopher://x/", "ftp://x/", "data:text/plain,x"]) {
      expect(tileBaseUrlError(bad), bad).toContain("http(s)");
    }
  });

  it("refuses embedded credentials", () => {
    expect(tileBaseUrlError("http://user:pass@tiles.example.com/t")).toContain("credentials");
    expect(tileBaseUrlError("http://user@tiles.example.com/t")).toContain("credentials");
  });

  it("refuses a value that is not a URL at all", () => {
    for (const bad of ["", "   ", "not a url", "http://", 7, null, {}]) {
      expect(tileBaseUrlError(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });

  it("refuses a query string or fragment, which cannot survive /{z}/{x}/{y}", () => {
    expect(tileBaseUrlError("https://tiles.example.com/t?key=abc")).toContain("query string");
    expect(tileBaseUrlError("https://tiles.example.com/t#frag")).toContain("fragment");
  });

  /**
   * The CLI's caller is the operator typing the command, who can already curl
   * anything this process can reach. A guard that refused their own localhost
   * tile proxy would be refusing the person it is protecting — and
   * `render.test.ts` renders through `http://127.0.0.1:1/tiles` for exactly that
   * reason.
   */
  it("[CONTROL] does NOT judge the destination without refuseNonRoutableHosts", () => {
    expect(tileBaseUrlError("http://127.0.0.1:5180/api/tiles")).toBeNull();
    expect(tileBaseUrlError("http://localhost:5180/api/tiles")).toBeNull();
    expect(tileBaseUrlError("http://169.254.169.254/latest/meta-data/")).toBeNull();
  });
});

describe("tileBaseUrlError — destination rules at the worker boundary", () => {
  it("[CONTROL] still accepts the compose deployment's own tile proxy", () => {
    // A private NAME, which is exactly what the API sends. If this ever fails,
    // the guard has taken every tile-proxied render down with it.
    expect(tileBaseUrlError("http://api:8080/api/tiles", WORKER)).toBeNull();
  });

  it("[CONTROL] still accepts a public tile server", () => {
    expect(
      tileBaseUrlError("https://basemap.nationalmap.gov/arcgis/rest/services", WORKER),
    ).toBeNull();
  });

  it("refuses the cloud metadata address", () => {
    const err = tileBaseUrlError("http://169.254.169.254/latest/meta-data/", WORKER);
    expect(err).toContain("non-routable");
  });

  it("refuses loopback, private, CGNAT, multicast and reserved literals", () => {
    for (const bad of [
      "http://127.0.0.1:9/tiles",
      "http://127.255.1.2/tiles",
      "http://10.0.0.5/tiles",
      "http://172.16.4.4/tiles",
      "http://172.31.255.255/tiles",
      "http://192.168.1.1/tiles",
      "http://100.64.0.1/tiles",
      "http://0.0.0.0/tiles",
      "http://224.0.0.1/tiles",
      "http://255.255.255.255/tiles",
      "http://198.18.0.1/tiles",
    ]) {
      expect(tileBaseUrlError(bad, WORKER), bad).toContain("non-routable");
    }
  });

  /**
   * The cases a regex or a `startsWith("http://127.")` check cannot see. The
   * WHATWG URL parser normalises all of these to `127.0.0.1` before the guard
   * looks, which is why the guard parses instead of pattern-matching.
   */
  it("refuses loopback however it is spelled", () => {
    for (const bad of [
      "http://2130706433/tiles",   // decimal
      "http://0177.0.0.1/tiles",   // octal
      "http://0x7f.1/tiles",       // hex + short form
      "http://127.1/tiles",        // short form
    ]) {
      expect(tileBaseUrlError(bad, WORKER), bad).toContain("non-routable");
    }
  });

  it("refuses non-routable IPv6, including v4-mapped loopback", () => {
    for (const bad of [
      "http://[::1]:8080/tiles",
      "http://[::]/tiles",
      "http://[fe80::1]/tiles",
      "http://[fc00::1]/tiles",
      "http://[ff02::1]/tiles",
      "http://[::ffff:127.0.0.1]/tiles",
      "http://[::ffff:10.0.0.1]/tiles",
    ]) {
      expect(tileBaseUrlError(bad, WORKER), bad).toContain("non-routable");
    }
  });

  it("[CONTROL] accepts a routable IPv6 literal", () => {
    expect(tileBaseUrlError("http://[2606:4700:4700::1111]/tiles", WORKER)).toBeNull();
  });

  it("refuses the localhost name, which means the same thing as 127.0.0.1", () => {
    expect(tileBaseUrlError("http://localhost:5180/api/tiles", WORKER)).toContain("non-routable");
    expect(tileBaseUrlError("http://x.localhost/tiles", WORKER)).toContain("non-routable");
  });

  it("names the remedy, so a refusal is actionable rather than a wall", () => {
    expect(tileBaseUrlError("http://127.0.0.1:5180/api/tiles", WORKER))
      .toContain("TILE_BASE_URL_ALLOWLIST");
  });
});

describe("tileBaseUrlError — the operator allowlist", () => {
  const allowlist = ["http://api:8080/api/tiles"];

  it("accepts the allowlisted base and paths below it", () => {
    expect(tileBaseUrlError("http://api:8080/api/tiles", { allowlist })).toBeNull();
    expect(tileBaseUrlError("http://api:8080/api/tiles/", { allowlist })).toBeNull();
    expect(tileBaseUrlError("http://api:8080/api/tiles/usgs-topo", { allowlist })).toBeNull();
  });

  it("refuses anything else, including other paths on the same host", () => {
    for (const bad of [
      "http://api:8080/api/admin",
      "http://api:8080/api/tilesX",   // prefix-adjacent, not below the base
      "http://db:5432/",
      "https://basemap.nationalmap.gov/x",
      "http://api:9090/api/tiles",    // different port
    ]) {
      expect(tileBaseUrlError(bad, { allowlist }), bad).toContain("allowlist");
    }
  });

  /**
   * [CONTROL] The escape hatch has to actually work, or the guard is just a
   * deny-all with extra words. An operator running the api on localhost and the
   * worker beside it names that destination and gets it.
   */
  it("[CONTROL] an allowlisted loopback base is accepted even under the worker policy", () => {
    const local = ["http://127.0.0.1:5180/api/tiles"];
    expect(
      tileBaseUrlError("http://127.0.0.1:5180/api/tiles/usgs-topo", {
        allowlist: local,
        refuseNonRoutableHosts: true,
      }),
    ).toBeNull();
  });

  /**
   * [CONTROL] An unset allowlist must not read as an empty one. Getting this
   * wrong refuses every tile-proxied render on any deployment that has not been
   * told about the new variable — the exact shape of an over-strict guard.
   */
  it("[CONTROL] no allowlist configured is not the same as permitting nothing", () => {
    expect(tileBaseUrlError("https://tile.example.com/t", { allowlist: [] })).toBeNull();
    expect(tileBaseUrlError("https://tile.example.com/t", {})).toBeNull();
    expect(tileBaseUrlError("https://tile.example.com/t", { allowlist: ["", "  "] })).toBeNull();
  });
});

describe("parseTileBaseUrlAllowlist", () => {
  it("reads comma- or whitespace-separated entries", () => {
    expect(parseTileBaseUrlAllowlist("http://a/t, http://b/t")).toEqual(["http://a/t", "http://b/t"]);
    expect(parseTileBaseUrlAllowlist("http://a/t\nhttp://b/t")).toEqual(["http://a/t", "http://b/t"]);
  });

  it("treats unset and blank as no allowlist configured", () => {
    expect(parseTileBaseUrlAllowlist(undefined)).toEqual([]);
    expect(parseTileBaseUrlAllowlist("")).toEqual([]);
    expect(parseTileBaseUrlAllowlist("   ,  ")).toEqual([]);
  });
});
