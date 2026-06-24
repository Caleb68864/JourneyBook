---
title: "TC 3-25.26 Part 1 Map Reading and Land Navigation"
category: "source-docs"
status: researched
priority: high
related:
  - "Land Navigation Curriculum"
  - "Compass Basics"
  - "Map Scale"
  - "Contour Lines"
  - "Terrain Association"
  - "UTM Grid"
  - "MGRS Grid"
  - "PDF Rendering Strategy"
source_urls:
  - "https://www.armywriter.com/board/references/TC3-25x26-Part1.pdf"
---

# TC 3-25.26 Part 1 Map Reading and Land Navigation

Local file: `vault/source-docs/TC3-25x26-Part1.pdf`

This Army training circular is the strongest source in the vault for the map-reading and land-navigation feel Journey Book should eventually support. The downloaded PDF is 126 pages and covers the first major portion of the manual: map reading, grids, scale and distance, direction, overlays, navigation equipment, and elevation/relief.

Note: the PDF cover includes a distribution restriction/destruction notice. Treat this as a user-provided reference source, avoid copying long passages, and use it primarily to guide product design, terminology, and training progression.

## Structure Indexed From The PDF

Part One: Map Reading
- Chapter 1: Training Strategy.
- Chapter 2: Maps.
- Chapter 3: Marginal Information and Symbols.
- Chapter 4: Grids.
- Chapter 5: Scale and Distance.
- Chapter 6: Directions.
- Chapter 7: Overlays.

Part Two start:
- Chapter 8: Navigation Equipment and Methods.
- Chapter 9: Elevation and Relief.

The table of contents also references later chapters and appendices such as terrain association, mounted navigation, navigation in different terrain, map folding, sketches, GPS, orienteering, and additional aids. Those appear to belong to the broader TC 3-25.26 manual set, even if this local Part 1 PDF emphasizes the earlier material.

## Product Design Implications

Journey Book should feel familiar to an experienced land-navigation user by preserving these concepts:
- North types: true north, magnetic north, and grid north.
- Declination information where compass work matters.
- Scale as both representative fraction and graphic scale.
- Distance measurement for straight and curved routes.
- Grids as a first-class location system, not decorative lines.
- UTM/MGRS as advanced overlays after the simple page grid is proven.
- Marginal information: sheet/page name, scale, edition/source date, legend, adjoining sheet/page references, declination, and attribution.
- Overlays as a design model for routes, landmarks, challenge layers, and parent/teacher annotations.
- Terrain relief with contour lines, index contours, intervals, shaded relief, and terrain features.

## Build Guidance

For MVP, keep the atlas kid-friendly, but make the page furniture structurally similar to a serious map:
- Page ID and adjoining page references.
- Scale bar and printed scale text.
- North arrow/compass rose.
- Source date and attribution.
- Legend for symbols actually used.
- Optional declination note.
- Optional grid overlay.

For post-MVP, add an "advanced land-nav" template that exposes more of the TC 3-25.26 vocabulary: UTM/MGRS, azimuths, back azimuths, resection/intersection exercises, terrain association, contour interpretation, and overlay/sketch worksheets.

See also: [[Land Navigation Curriculum]], [[Compass Basics]], [[Map Scale]], [[Contour Lines]], [[Terrain Association]], [[UTM Grid]], [[MGRS Grid]], [[PDF Rendering Strategy]]
