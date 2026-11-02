using System.Net;
using System.Text.Json;

namespace JourneyBook.Tests.Api;

/// <summary>
/// The only runtime consumer of <c>Microsoft.OpenApi</c> is the document this endpoint
/// generates, and it is generated on request — so a version of that package that
/// <c>Microsoft.AspNetCore.OpenApi</c> cannot actually drive still builds, still boots,
/// and fails only here. Nothing requested this document before, which left the package
/// advisory's upgrade (NU1903, GHSA-v5pm-xwqc-g5wc) with no test able to notice it had
/// broken anything.
/// </summary>
public class OpenApiDocumentTests(PostgisApiFactory factory) : IClassFixture<PostgisApiFactory>
{
    [Fact]
    public async Task The_document_generates_and_describes_the_real_endpoints()
    {
        var response = await factory.CreateClient().GetAsync("/openapi/v1.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.StartsWith("3.", document.RootElement.GetProperty("openapi").GetString());
        var paths = document.RootElement.GetProperty("paths");
        Assert.True(
            paths.TryGetProperty("/api/projects", out _),
            "/api/projects is missing from the generated document, so generation ran over an empty or partial endpoint set.");
    }
}
