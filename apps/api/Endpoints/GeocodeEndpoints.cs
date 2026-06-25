using JourneyBook.Application.Geocoding;
using JourneyBook.Application.Rendering;

namespace JourneyBook.Api.Endpoints;

public static class GeocodeEndpoints
{
    public static IEndpointRouteBuilder MapGeocodeEndpoints(this IEndpointRouteBuilder app)
    {
        // Forward-geocode a free-text address/place. Optional west/south/east/north
        // bias results toward a project's extent. Returns candidate positions only —
        // the web turns a chosen result into an important location via the existing
        // locations endpoint (recording GeocodedFrom/GeocodeProvider).
        app.MapGet("/api/geocode", async (
            string? q,
            double? west,
            double? south,
            double? east,
            double? north,
            IGeocodeClient geocoder,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(q))
            {
                return Results.BadRequest(new { error = "Query parameter 'q' is required." });
            }

            RenderBBoxDto? viewbox =
                west is { } w && south is { } s && east is { } e && north is { } n
                    ? new RenderBBoxDto(w, s, e, n)
                    : null;

            var results = await geocoder.SearchAsync(q, viewbox, ct);
            return Results.Ok(results);
        });

        return app;
    }
}
