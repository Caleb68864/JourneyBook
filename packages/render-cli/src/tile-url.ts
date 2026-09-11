/**
 * Validation for `tileBaseUrl` — the one render input that makes the process
 * issue an outbound HTTP request to a destination the input chose.
 *
 * Until now this was a single regex, `/^https?:\/\//i`, in two places. That
 * stops `file://` and `gopher://` and nothing else: from inside the compose
 * network `http://db:5432/`, `http://api:8080/api/admin/...` and
 * `http://169.254.169.254/latest/meta-data/` all matched it. The worker takes
 * this field straight off an unauthenticated request body, so the only thing
 * standing between a caller and an internal fetch was that the worker is
 * `expose`d rather than `ports`-published — a deployment accident, not a
 * control. (`vault/audit-2026-09-08/scan-1-architecture.md` F03.)
 *
 * Two layers, deliberately separated by WHO is speaking:
 *
 *  - **Structural** (always). Scheme, embedded credentials, and the shape of a
 *    base path. These can never be legitimate, from any caller, so the CLI
 *    applies them too.
 *  - **Destination** (`refuseNonRoutableHosts`, plus `allowlist`). Applied at
 *    the worker's HTTP boundary, where the caller is untrusted. NOT applied by
 *    `render-cli`: the CLI's caller is the operator typing the command, who can
 *    already curl anything the process can reach, and `--tile-base-url
 *    http://localhost:5180/api/tiles` is a documented local workflow. A guard
 *    that refuses it would be refusing its own operator.
 *
 * On hostnames vs IP literals. A literal is classified here; a *name* is not
 * resolved. Two reasons, and they are not laziness: this runs synchronously
 * inside input validation, and a resolve-then-fetch check is defeated by DNS
 * rebinding anyway. The control for names is the operator allowlist — which is
 * also the only thing that can distinguish `http://api:8080/api/tiles` (the
 * intended destination, a private name) from `http://db:5432` (not).
 *
 * An allowlisted entry OVERRIDES the non-routable check, on purpose: an
 * operator who writes `http://127.0.0.1:5180/api/tiles` into the allowlist has
 * named that destination deliberately, and a guard that then refused it would be
 * refusing the only person entitled to decide.
 */

/** How strictly to judge where a `tileBaseUrl` points. */
export interface TileBaseUrlPolicy {
  /**
   * Operator-permitted base URLs. When non-empty, `tileBaseUrl` must be one of
   * them or a path below one of them, and nothing else is accepted. When empty
   * or absent, no allowlist is configured and only the other rules apply.
   */
  allowlist?: readonly string[];
  /**
   * Refuse hosts that cannot be a public tile server: loopback, private,
   * link-local (including the 169.254.169.254 cloud-metadata address), CGNAT,
   * multicast and reserved IP literals, and the `localhost` name. Only for
   * callers that are not the operator — see the module docblock.
   */
  refuseNonRoutableHosts?: boolean;
}

/** Parse a dotted-quad IPv4 literal into its four octets, or null. */
function ipv4Octets(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/**
 * True when the dotted-quad is not a globally routable unicast address.
 *
 * The WHATWG URL parser normalises every alternative IPv4 spelling to dotted
 * quad before this sees it — `http://2130706433/`, `http://0177.0.0.1/`,
 * `http://0x7f.1/` and `http://127.1/` all arrive as `127.0.0.1` — so this does
 * not need to re-implement those encodings, and a guard that pattern-matched on
 * the original string would have missed all four.
 */
function isNonRoutableIpv4(octets: readonly [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true;                                  // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                 // RFC1918
  if (a === 127) return true;                                // loopback
  if (a === 100 && b >= 64 && b <= 127) return true;         // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                   // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;          // RFC1918
  if (a === 192 && b === 168) return true;                   // RFC1918
  if (a === 192 && b === 0) return true;                     // 192.0.0/24 IETF + 192.0.2/24 TEST-NET
  if (a === 198 && (b === 18 || b === 19)) return true;       // 198.18/15 benchmarking
  if (a >= 224) return true;                                 // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 literal (no brackets) to its eight 16-bit groups, or null. */
function ipv6Groups(host: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(host)) return null;
  const halves = host.split("::");
  if (halves.length > 2) return null;

  const parse = (chunk: string): number[] | null => {
    if (chunk === "") return [];
    const out: number[] = [];
    for (const piece of chunk.split(":")) {
      if (piece.includes(".")) {
        // Trailing embedded IPv4 (`::ffff:127.0.0.1`). Node normalises this to
        // hex before we see it, but a literal can still arrive this way.
        const quad = ipv4Octets(piece);
        if (!quad) return null;
        out.push((quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };

  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

/** True when the IPv6 literal is not a globally routable unicast address. */
function isNonRoutableIpv6(groups: readonly number[]): boolean {
  const allZero = groups.every((g) => g === 0);
  if (allZero) return true;                                          // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1

  const first = groups[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true;                      // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true;                      // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true;                      // ff00::/8 multicast

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judge the embedded v4.
  const mapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
      ? [groups[6] ?? 0, groups[7] ?? 0]
      : groups.slice(0, 6).every((g) => g === 0) && (groups[6] ?? 0) !== 0
        ? [groups[6] ?? 0, groups[7] ?? 0]
        : null;
  if (mapped) {
    const [hi, lo] = mapped as [number, number];
    return isNonRoutableIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  return false;
}

/**
 * True when `host` cannot be a public tile server. Hostnames other than
 * `localhost` are NOT judged here — see the module docblock.
 */
function isNonRoutableHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  if (host.startsWith("[") && host.endsWith("]")) {
    const groups = ipv6Groups(host.slice(1, -1));
    return groups === null ? false : isNonRoutableIpv6(groups);
  }

  const quad = ipv4Octets(host);
  return quad === null ? false : isNonRoutableIpv4(quad);
}

/** Strip trailing slashes, the way `renderMapPanel` does before appending. */
function normalizeBase(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * The reason `value` is not an acceptable tile base URL, or null when it is.
 *
 * Returns a message rather than throwing so each caller can decide the shape of
 * its own failure — the engine throws, the worker answers 400 — and so a
 * refusal always carries WHY and, where relevant, how an operator permits it.
 * `undefined` is acceptable (the field is optional); anything else non-string is
 * not.
 */
export function tileBaseUrlError(value: unknown, policy: TileBaseUrlPolicy = {}): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    return "Invalid tileBaseUrl: must be an http(s) URL.";
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `Invalid tileBaseUrl "${value}": not a URL.`;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Invalid tileBaseUrl "${value}": must be an http(s) URL.`;
  }
  if (url.username !== "" || url.password !== "") {
    return "Invalid tileBaseUrl: embedded credentials are not accepted.";
  }
  if (url.hostname === "") {
    return `Invalid tileBaseUrl "${value}": no host.`;
  }
  if (url.search !== "" || url.hash !== "") {
    // The base is a PATH PREFIX: `renderMapPanel` appends
    // `/{source}/{z}/{x}/{y}` to it. A query or fragment cannot survive that
    // concatenation, so accepting one buys a 404 storm instead of one clear
    // refusal.
    return "Invalid tileBaseUrl: a query string or fragment cannot be a tile base path.";
  }

  const allowlist = (policy.allowlist ?? []).filter((entry) => entry.trim() !== "");
  if (allowlist.length > 0) {
    const candidate = normalizeBase(url.href);
    const permitted = allowlist.some((entry) => {
      const base = normalizeBase(entry.trim());
      return candidate === base || candidate.startsWith(`${base}/`);
    });
    if (!permitted) {
      return (
        `tileBaseUrl "${value}" is not permitted by this worker's tile base URL allowlist ` +
        `(${allowlist.join(", ")}). Add it to TILE_BASE_URL_ALLOWLIST to permit it.`
      );
    }
    // Explicitly named by the operator — that decision outranks the heuristic
    // below, which is what makes a loopback tile proxy workable.
    return null;
  }

  if (policy.refuseNonRoutableHosts && isNonRoutableHost(url.hostname)) {
    return (
      `tileBaseUrl "${value}" points at a non-routable address (${url.hostname}), which cannot be ` +
      "a public tile server. Set TILE_BASE_URL_ALLOWLIST to permit a specific internal tile proxy."
    );
  }

  return null;
}

/**
 * Parse `TILE_BASE_URL_ALLOWLIST` — comma- or whitespace-separated base URLs.
 * An unset or blank value means "no allowlist configured", which is not the same
 * as an empty allowlist and must not be read as "permit nothing".
 */
export function parseTileBaseUrlAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
