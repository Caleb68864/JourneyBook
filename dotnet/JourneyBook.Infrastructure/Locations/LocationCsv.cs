using System.Globalization;
using JourneyBook.Application.Locations;

namespace JourneyBook.Infrastructure.Locations;

/// <summary>One parsed CSV row, ready to become an <c>ImportantLocation</c>.</summary>
public record LocationCsvRow(
    string Name,
    double Lng,
    double Lat,
    string? Notes,
    string? ScalePresetId,
    string? PinShape = null,
    string? PinColor = null,
    string[]? ZoomLevels = null);

/// <summary>
/// Minimal RFC4180-ish CSV parser for location imports. A header row is required;
/// columns are matched by name (case-insensitive): <c>name</c>, <c>lng</c>|
/// <c>longitude</c>, <c>lat</c>|<c>latitude</c> (required); <c>notes</c>,
/// <c>scale</c>|<c>scalePresetId</c>, <c>pin</c>|<c>shape</c>, <c>color</c>|
/// <c>pinColor</c>, <c>zoom</c>|<c>zoomLevels</c> (optional). The zoom column is a
/// <c>|</c>- or <c>;</c>-separated ladder of scale preset ids, coarse to fine.
/// These are the same columns the headless render-cli reads, so one file drives
/// both the web importer and a CLI render. Supports double-quoted fields
/// (with <c>""</c> escaping) so notes may contain commas. Aggregates all row
/// errors into one <see cref="LocationValidationException"/> (all-or-nothing).
/// </summary>
public static class LocationCsv
{
    /// <summary>
    /// Split a zoom-ladder cell ("1-100000|1-50000|usgs-7-5-min"; <c>;</c> also
    /// accepted) into ordered scale preset ids. Empty → null (no ladder). The ids
    /// themselves are validated against the seeded ScalePresets by the service,
    /// alongside the per-location scale override.
    /// </summary>
    internal static string[]? ParseZoomLevels(string? cell)
    {
        if (string.IsNullOrWhiteSpace(cell)) return null;
        var ids = cell.Split(['|', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return ids.Length > 0 ? ids : null;
    }

    public static IReadOnlyList<LocationCsvRow> Parse(string csv)
    {
        var lines = SplitLines(csv);
        if (lines.Count == 0)
            throw new LocationValidationException("CSV is empty — expected a header row and at least one location.");

        var header = ParseLine(lines[0]).Select(h => h.Trim().ToLowerInvariant()).ToList();
        // `label` because the web app's own project export writes that column and
        // the headless CLI has always accepted it; without it a file exported from
        // this product failed to import back into it.
        int nameIdx = IndexOfAny(header, "name", "label");
        int lngIdx = IndexOfAny(header, "lng", "longitude", "lon");
        int latIdx = IndexOfAny(header, "lat", "latitude");
        int notesIdx = IndexOfAny(header, "notes", "note");
        int scaleIdx = IndexOfAny(header, "scale", "scalepresetid", "scaleid");
        int pinIdx = IndexOfAny(header, "pin", "pinshape", "shape");
        int colorIdx = IndexOfAny(header, "color", "pincolor", "colour");
        int zoomIdx = IndexOfAny(header, "zoom", "zoomlevels", "levels");

        var missing = new List<string>();
        if (nameIdx < 0) missing.Add("name");
        if (lngIdx < 0) missing.Add("lng");
        if (latIdx < 0) missing.Add("lat");
        if (missing.Count > 0)
            throw new LocationValidationException(
                $"CSV header is missing required column(s): {string.Join(", ", missing)}. Expected: name, lng, lat[, notes][, scale].");

        var rows = new List<LocationCsvRow>();
        var errors = new List<string>();

        for (int i = 1; i < lines.Count; i++)
        {
            var fields = ParseLine(lines[i]);
            int rowNo = i + 1; // 1-based, header is row 1

            string name = Get(fields, nameIdx).Trim();
            if (name.Length == 0)
            {
                errors.Add($"row {rowNo}: name is required");
                continue;
            }

            if (!TryParseCoord(Get(fields, lngIdx), out double lng) || lng < -180 || lng > 180)
            {
                errors.Add($"row {rowNo}: lng must be a number in [-180, 180] (got \"{Get(fields, lngIdx)}\")");
                continue;
            }
            if (!TryParseCoord(Get(fields, latIdx), out double lat) || lat < -90 || lat > 90)
            {
                errors.Add($"row {rowNo}: lat must be a number in [-90, 90] (got \"{Get(fields, latIdx)}\")");
                continue;
            }

            string? notes = notesIdx >= 0 ? NullIfEmpty(Get(fields, notesIdx).Trim()) : null;
            string? scale = scaleIdx >= 0 ? NullIfEmpty(Get(fields, scaleIdx).Trim()) : null;
            string? pinShape = pinIdx >= 0 ? NullIfEmpty(Get(fields, pinIdx).Trim()) : null;
            string? pinColor = colorIdx >= 0 ? NullIfEmpty(Get(fields, colorIdx).Trim()) : null;
            string[]? zoomLevels = zoomIdx >= 0 ? ParseZoomLevels(Get(fields, zoomIdx)) : null;

            rows.Add(new LocationCsvRow(name, lng, lat, notes, scale, pinShape, pinColor, zoomLevels));
        }

        if (errors.Count > 0)
            throw new LocationValidationException($"CSV import failed ({errors.Count} bad row(s)): {string.Join("; ", errors)}.");

        if (rows.Count == 0)
            throw new LocationValidationException("CSV has a header but no location rows.");

        return rows;
    }

    private static bool TryParseCoord(string s, out double value) =>
        double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out value);

    /// <summary>
    /// The column for the first of <paramref name="names"/> that the header has.
    /// </summary>
    /// <remarks>
    /// Priority is by ALIAS ORDER, not by column order, which matters only when a
    /// header carries two aliases for one field — and that is exactly when it
    /// matters most. This used to scan the header and take the first column whose
    /// name was in the set, while the headless CLI took the first alias present;
    /// so on a header of <c>name,lon,lng,lat</c> the importer read <c>lon</c> and
    /// the CLI read <c>lng</c>, both succeeded, and the same file produced two
    /// different locations with nothing reported anywhere. Alias order is the
    /// documented rule because it is a property of this parser, not of whatever
    /// order a spreadsheet happened to write the columns in.
    /// </remarks>
    private static int IndexOfAny(List<string> header, params string[] names)
    {
        foreach (var name in names)
        {
            int idx = header.IndexOf(name);
            if (idx >= 0) return idx;
        }
        return -1;
    }

    private static string Get(List<string> fields, int idx) =>
        idx >= 0 && idx < fields.Count ? fields[idx] : string.Empty;

    private static string? NullIfEmpty(string s) => s.Length == 0 ? null : s;

    /// <summary>Split into lines, dropping a leading BOM and skipping blank lines.</summary>
    private static List<string> SplitLines(string csv)
    {
        var normalized = (csv ?? string.Empty).Replace("\r\n", "\n").Replace("\r", "\n").TrimStart('﻿');
        return normalized.Split('\n').Where(l => l.Trim().Length > 0).ToList();
    }

    /// <summary>Parse one CSV line into fields, honoring double-quoted fields with "" escaping.</summary>
    private static List<string> ParseLine(string line)
    {
        var fields = new List<string>();
        var sb = new System.Text.StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                    else inQuotes = false;
                }
                else sb.Append(c);
            }
            else
            {
                if (c == '"') inQuotes = true;
                else if (c == ',') { fields.Add(sb.ToString()); sb.Clear(); }
                else sb.Append(c);
            }
        }
        fields.Add(sb.ToString());
        return fields;
    }
}
