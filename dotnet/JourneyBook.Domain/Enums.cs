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
    Other,
}

/// <summary>Lifecycle of a generated PDF render.</summary>
public enum PdfStatus
{
    Pending = 0,
    Rendering = 1,
    Completed = 2,
    Failed = 3,
}
