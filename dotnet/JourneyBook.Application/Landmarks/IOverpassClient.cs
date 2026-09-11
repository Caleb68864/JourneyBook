using JourneyBook.Application.Rendering;
using JourneyBook.Application.Common;

namespace JourneyBook.Application.Landmarks;

/// <summary>
/// Client for the OpenStreetMap Overpass API. Queries the curated landmark tag
/// set over a WGS84 extent and returns raw points of interest before category
/// mapping, culling, and scoring. Implementations degrade gracefully: a network
/// or upstream failure yields an empty list rather than throwing, so an import
/// never fails the request on Overpass being unavailable.
/// </summary>
public interface IOverpassClient
{
    /// <summary>
    /// Query Overpass for landmark points of interest within the given extent
    /// (<see cref="BBoxDto"/>, reusing the rendering extent contract).
    /// Returns the raw <see cref="OverpassPoi"/> rows, or an empty list on
    /// failure (graceful — never throws for upstream errors).
    /// </summary>
    Task<IReadOnlyList<OverpassPoi>> QueryLandmarksAsync(BBoxDto bbox, CancellationToken ct = default);
}
