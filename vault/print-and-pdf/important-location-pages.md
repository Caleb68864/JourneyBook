---
title: "Important Location Pages"
category: "print-and-pdf"
status: researched
priority: high
related:
  - "Accepting Locations"
  - "Index Page Generation"
  - "Legend Generation"
  - "Printable Atlas Generation"
  - "Page Labeling A1 B2"
source_urls:
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page/size"
  - "https://epsg.io/4326"
  - "https://operations.osmfoundation.org/policies/nominatim/"
---

# Important Location Pages

Journey Book should support user-added important locations such as Grandma's house, school, a campground, a town, a trailhead, or a vacation stop. These are intentionally chosen by the user and should be treated differently from automatically selected landmarks.

## Core Behavior

The user can add a named location by search, address, coordinate, clicked map point, or imported list. Each important location should store:
- Name.
- Optional category.
- Coordinate geometry.
- Source or geocoding confidence.
- Notes.
- Icon/symbol choice.
- Whether to include a dedicated location page.
- Whether to show a main-atlas reference label.

## Dedicated Pages

When printing the atlas, selected important locations can receive their own dedicated page. A location page should include:
- Location title.
- Detail map centered on the location.
- Main atlas page reference.
- Coordinates or optional grid reference.
- Nearby landmarks.
- Distance/route context if available.
- Notes or activity prompt.

This lets the main atlas stay clean while still giving special places room to breathe.

## Main Atlas References

The main atlas map should be able to label an important location with a reference such as:
- Grandma's House - see page L1.
- Lincoln - see Location Page 3.
- Campground - detail map on page L2.

Reference labels should be sparse and collision-aware. They should not cover road names, route lines, or page continuation labels.

## Index and Legend

The index page should include an Important Locations section that lists every saved place, its atlas grid page, and its dedicated location page if one exists.

The legend or a separate "Places" page should explain the symbol used for important locations and the meaning of "see page X" references.

## Data Model Notes

Important locations should be project-owned records, not temporary map annotations. They should be stored in PostGIS as points or small extents and linked to generated pages after PDF layout.

Use a separate location-page numbering scheme such as L1, L2, L3 so location pages do not collide with atlas grid pages like A1 or B2.

See also: [[Accepting Locations]], [[Index Page Generation]], [[Legend Generation]], [[Printable Atlas Generation]], [[Page Labeling A1 B2]]
