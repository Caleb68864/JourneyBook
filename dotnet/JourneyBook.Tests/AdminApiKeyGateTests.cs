using JourneyBook.Api;

namespace JourneyBook.Tests;

/// <summary>
/// The tile-source registry's write endpoints were anonymous, which is how an
/// attacker got a URL into the registry for the proxy to fetch. This gate is the
/// authorisation half of that fix.
/// </summary>
public class AdminApiKeyGateTests
{
    [Fact]
    public void With_no_key_configured_the_registry_is_read_only()
    {
        var gate = new AdminApiKeyGate(null);

        Assert.False(gate.IsConfigured);
        // Fails CLOSED. An operator who never read the setting gets a registry
        // nobody can write to, not one anyone can write to.
        Assert.False(gate.IsAuthorized(null));
        Assert.False(gate.IsAuthorized(""));
        Assert.False(gate.IsAuthorized("anything"));
        Assert.Contains("read-only", gate.DenialReason);
    }

    [Fact]
    public void Whitespace_is_not_a_configured_key()
    {
        Assert.False(new AdminApiKeyGate("   ").IsConfigured);
        Assert.False(new AdminApiKeyGate("   ").IsAuthorized("   "));
    }

    [Fact]
    public void The_configured_key_authorizes_and_nothing_else_does()
    {
        var gate = new AdminApiKeyGate("s3cret-admin-key");

        Assert.True(gate.IsAuthorized("s3cret-admin-key"));
        Assert.False(gate.IsAuthorized("wrong"));
        Assert.False(gate.IsAuthorized(null));
        Assert.False(gate.IsAuthorized(""));
        // No prefix match: a partial key must not be treated as a near miss.
        Assert.False(gate.IsAuthorized("s3cret"));
        Assert.False(gate.IsAuthorized("s3cret-admin-keyy"));
        Assert.Contains("X-Admin-Key", gate.DenialReason);
    }

    [Fact]
    public void Comparison_is_case_sensitive()
    {
        var gate = new AdminApiKeyGate("AbC");
        Assert.False(gate.IsAuthorized("abc"));
        Assert.True(gate.IsAuthorized("AbC"));
    }
}
