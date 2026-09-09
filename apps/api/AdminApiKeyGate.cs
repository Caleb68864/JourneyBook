namespace JourneyBook.Api;

/// <summary>
/// Decides whether a request may mutate the global tile-source registry.
///
/// <para>
/// <b>Why a key and not real auth.</b> This API has no authentication of any kind
/// — no <c>AddAuthentication</c>, no <c>AddAuthorization</c>, no identity — and
/// inventing one is a product decision, not an audit fix. But the registry is the
/// SSRF's entry point: an anonymous <c>POST /api/tile-sources</c> stored a URL the
/// server would then fetch and reflect. A shared admin key is the smallest thing
/// that closes "anyone on the network can register a tile source" without
/// pretending to be an identity system, and it is a stepping stone: when real auth
/// arrives, this gate is one call to delete.
/// </para>
///
/// <para>
/// <b>It fails closed.</b> With no key configured, mutation is denied outright
/// rather than allowed — an operator who never read the setting gets a registry
/// that cannot be written to, which is safe, instead of one anyone can write to,
/// which is what the audit found. Reads stay anonymous: the web app lists sources,
/// and listing them was never the hole.
/// </para>
/// </summary>
public sealed class AdminApiKeyGate(string? configuredKey)
{
    /// <summary>Header carrying the admin key.</summary>
    public const string HeaderName = "X-Admin-Key";

    /// <summary>True when an admin key has been configured at all.</summary>
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuredKey);

    /// <summary>
    /// Is <paramref name="presentedKey"/> the configured admin key?
    /// Returns false when no key is configured (fail closed).
    /// </summary>
    public bool IsAuthorized(string? presentedKey)
    {
        if (!IsConfigured) return false;
        if (string.IsNullOrEmpty(presentedKey)) return false;

        // Fixed-time comparison: a plain == leaks the key one character at a time
        // to anyone who can measure the response, and this key guards the thing
        // that decides where the server makes outbound requests.
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(presentedKey),
            System.Text.Encoding.UTF8.GetBytes(configuredKey!));
    }

    /// <summary>
    /// The reason a request was refused, for the response body. Distinguishes "the
    /// server has no key set" from "your key is wrong", because those need
    /// completely different actions from whoever hits them, and neither discloses
    /// anything an attacker could not already determine.
    /// </summary>
    public string DenialReason => IsConfigured
        ? "A valid X-Admin-Key header is required to modify the tile-source registry."
        : "The tile-source registry is read-only: no TileSources:AdminApiKey is configured on this server.";
}
