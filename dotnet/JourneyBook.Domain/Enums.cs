namespace JourneyBook.Domain;

/// <summary>Page orientation for printed atlas sheets.</summary>
public enum PageOrientation
{
    Portrait = 0,
    Landscape = 1,
}

/// <summary>Category of a user-added important location.</summary>
public enum LocationCategory
{
    Other = 0,
    Home = 1,
    School = 2,
    Town = 3,
    Campground = 4,
    Trailhead = 5,
    Park = 6,
    Water = 7,
}

/// <summary>How trustworthy the position of an important location is.</summary>
public enum SourceConfidence
{
    Unknown = 0,
    Low = 1,
    Medium = 2,
    High = 3,
}

/// <summary>Category of an OSM-sourced landmark imported via the landmark pipeline.</summary>
public enum LandmarkCategory
{
    Peak,
    Water,
    Tower,
    School,
    Worship,
    Civic,
    Park,
    Viewpoint,
    Trailhead,
    Station,
    // Road-trip services (useful POIs along a route).
    Fuel,
    Food,
    Lodging,
    RestArea,
    Other,
}

/// <summary>Lifecycle of a generated PDF render.</summary>
/// <remarks>
/// Stored as a STRING (<c>GeneratedPdfConfiguration</c> sets
/// <c>HasConversion&lt;string&gt;()</c> with a 20-character cap), so these numeric
/// values are not persisted and a new member is not by itself a schema change.
/// <c>ScalePresetParityTests</c>' lesson applies in reverse here: check what the
/// gate actually sees rather than assuming.
/// </remarks>
public enum PdfStatus
{
    Pending = 0,
    Rendering = 1,
    Completed = 2,
    Failed = 3,

    /// <summary>The render was stopped because someone asked for it to stop.</summary>
    /// <remarks>
    /// Distinct from <see cref="Failed"/> and that distinction is the point. Both
    /// end with no PDF, but one of them is what the user asked for; a cancel
    /// reported as a failure sends someone looking for a diagnostic that does not
    /// exist. ADR 0006 accepted "a cancelled or shut-down render is marked Failed"
    /// as a limitation of having no cancel at all; ADR 0007 adds the cancel, so the
    /// limitation has to go with it.
    ///
    /// Host shutdown deliberately stays <see cref="Failed"/>: nobody asked for it,
    /// and the record's advice is "generate the atlas again", not "you stopped it".
    /// </remarks>
    Cancelled = 4,
}
