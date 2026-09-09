using JourneyBook.Api;
using JourneyBook.Application.Locations;
using JourneyBook.Application.Projects;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Tests;

/// <summary>
/// The API had no exception handler, so ordinary bad input escaped as a 500 —
/// and under the Development profile Compose defaulted to, that 500 carried a
/// stack trace. These cover the mapping itself, which is a pure function so it
/// is testable without a host or a Docker daemon; the endpoint-level behaviour
/// is covered by the Testcontainers suites.
/// </summary>
public class ExceptionMappingTests
{
    [Fact]
    public void Location_validation_is_a_400_that_echoes_the_message()
    {
        var (status, message) = ExceptionMapping.Map(
            new LocationValidationException("Invalid scale preset 'nope'."));

        Assert.Equal(400, status);
        Assert.Equal("Invalid scale preset 'nope'.", message);
    }

    [Fact]
    public void Project_validation_is_a_400_that_echoes_the_message()
    {
        var (status, message) = ExceptionMapping.Map(
            new ProjectValidationException("Unknown scale preset 'nope'."));

        Assert.Equal(400, status);
        Assert.Equal("Unknown scale preset 'nope'.", message);
    }

    [Fact]
    public void Tile_source_validation_is_a_409_matching_the_endpoint_that_already_catches_it()
    {
        var (status, _) = ExceptionMapping.Map(
            new TileSourceValidationException("A tile source with key 'usgs' already exists."));

        // TileSourceEndpoints returns Conflict for this; the global handler must
        // not disagree with the endpoint it sits beneath.
        Assert.Equal(409, status);
    }

    [Fact]
    public void Argument_exception_is_a_400()
    {
        // The concrete regression: PUT /api/generated-pdfs/{id}/status with an
        // unknown status threw out of GeneratedPdfService.ParseStatus and 500'd.
        var (status, message) = ExceptionMapping.Map(
            new ArgumentException("Invalid PDF status 'Banana'.", "value"));

        Assert.Equal(400, status);
        Assert.Contains("Invalid PDF status 'Banana'.", message);
    }

    [Fact]
    public void Argument_null_is_our_bug_not_the_callers_so_it_stays_a_500()
    {
        var (status, message) = ExceptionMapping.Map(new ArgumentNullException("thing"));

        Assert.Equal(500, status);
        Assert.Equal(ExceptionMapping.UnexpectedMessage, message);
    }

    [Fact]
    public void Unknown_exceptions_are_500_and_the_message_never_crosses_the_wire()
    {
        // An arbitrary exception message is an internal detail — connection
        // strings, file paths, SQL. It must not be echoed just because the
        // exception escaped.
        var secret = "Host=db;Username=journeybook;Password=hunter2";
        var (status, message) = ExceptionMapping.Map(new InvalidOperationException(secret));

        Assert.Equal(500, status);
        Assert.Equal(ExceptionMapping.UnexpectedMessage, message);
        Assert.DoesNotContain("hunter2", message);
    }

    [Fact]
    public void Not_supported_is_a_500_without_detail()
    {
        // TileService throws this when no fetcher handles a source's kind — a
        // server misconfiguration, not something the caller can correct.
        var (status, message) = ExceptionMapping.Map(
            new NotSupportedException("No tile fetcher handles kind 'wms'."));

        Assert.Equal(500, status);
        Assert.Equal(ExceptionMapping.UnexpectedMessage, message);
    }
}
