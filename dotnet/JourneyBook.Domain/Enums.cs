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

/// <summary>Helpers over <see cref="PdfStatus"/>.</summary>
public static class PdfStatusExtensions
{
    /// <summary>
    /// The statuses a record never leaves.
    /// </summary>
    /// <remarks>
    /// ONE statement of it. The set was written out by hand in four places — the
    /// startup reconciliation's complement, the progress writer's complement, the web
    /// client's <c>TERMINAL_STATUSES</c>, and a test helper — and adding
    /// <see cref="PdfStatus.Cancelled"/> updated three of them. The fourth polled a
    /// cancelled record for thirty seconds and then reported a timeout that had not
    /// happened, which is precisely the failure <c>PdfStatusParityTests</c> describes
    /// for a client that has not heard of a status. A terminal status the reader does
    /// not recognise is indistinguishable from a render that never finishes.
    /// </remarks>
    public static bool IsTerminal(this PdfStatus status) =>
        status is PdfStatus.Completed or PdfStatus.Failed or PdfStatus.Cancelled;

    /// <summary>True while a render is queued or running — the complement of <see cref="IsTerminal"/>.</summary>
    public static bool IsInFlight(this PdfStatus status) => !status.IsTerminal();
}
