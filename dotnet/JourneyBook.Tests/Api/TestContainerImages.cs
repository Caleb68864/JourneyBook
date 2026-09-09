namespace JourneyBook.Tests.Api;

/// <summary>
/// The container images the integration tests boot against.
/// </summary>
/// <remarks>
/// One home, because there were four. Each API test factory built its own
/// PostGIS container and named the image itself, so the version was written
/// down four times and could only ever be upgraded four times. A test suite
/// that silently runs half its cases against a different database version than
/// the other half is a bad way to spend an afternoon.
/// </remarks>
internal static class TestContainerImages
{
    /// <summary>PostGIS, matching the image the compose stack runs.</summary>
    internal const string Postgis = "postgis/postgis:16-3.4";
}
