---
title: "Road Atlas Conventions"
category: "research"
status: researched
priority: medium
related:
  - "Progressive Map Skills Curriculum"
  - "Land Nav Learning Curve Recommendation"
  - "Staged Build Roadmap"
  - "Branding Theme"
  - "Captain Input — Road Atlas vs Land Nav"
source_urls:
  - "https://help.randmcnally.com/news-press/release/rand-mcnally-publishes-its-annual-atlas-for-professional-drivers"
  - "https://randpublishing.com/rand-mcnally-publishes-its-2027-annual-atlas-for-commercial-drivers/"
  - "https://thomasmaps.com/2026-usa-large-scale-road-atlas-rand-mcnally/"
---

# Road Atlas Conventions

A Rand McNally-style road atlas is the most familiar, kid-readable map format in America, and it answers the daughters' two actual questions — *where are we* and *how much longer* — without any military vocabulary. Journey Book's **Level 1** (see [[Progressive Map Skills Curriculum]]) should borrow these conventions wholesale, because the project already has a page-grid model that maps onto them almost 1:1.

## Borrowable Conventions

- **Alphanumeric grid index (A1 / B2).** Each page is divided into a coarse lettered-column / numbered-row grid; a place-name index says "Lincoln ..... 42 C3" = page 42, column C, row 3. This is a *gentle* grid — a child can find a square without coordinates. It is the on-ramp to real UTM/MGRS reading later.
- **Comprehensive place-name index.** Alphabetical list of towns/landmarks → page + grid cell. The kid game "find where we are" becomes "find our town in the index, flip to the page, find the square."
- **Mileage / distance tables.** Rand McNally prints city-to-city mileage charts and a driving-times map (distances + drive time between major cities/parks). This directly powers *how much longer* — the core promise from [[Captain Input — Road Atlas vs Land Nav]].
- **Mile markers & junction mileages.** Small numbers along highways giving distance between junctions; lets a kid estimate remaining distance from the current exit.
- **Page-to-page continuation.** "Continued on page 43" arrows at page edges so a route spans multiple pages without losing the thread. Journey Book already has N/S/E/W neighbor references and `CONTINUE NORTH TO A2` labels (see [[Branding Theme]] and Stage 1B/1D of [[Staged Build Roadmap]]).
- **City insets & landmark callouts.** Detailed inset maps for dense areas; recognizable landmarks (parks, rivers, water towers) as anchor points — kid-friendly and TD1-appropriate.
- **Legend / map key.** A simple symbol key (road classes, parks, rest stops). The first "marginal information" a child meets, scaffolding toward full TC 3-25.26 marginal information later.

## How They Map To The Page-Grid Model

Journey Book's existing model already has most of this plumbing — the road-atlas layer is mostly *labeling and index generation*, not new geometry:

| Road-atlas convention | Existing Journey Book mechanism |
| --- | --- |
| Page ID (page 42) | `AtlasPage` page IDs (A1, B2) — Stage 1B |
| Alphanumeric in-page grid (C3) | A coarse locator grid drawn inside each page's printable viewport |
| Continuation arrows | N/S/E/W neighbor refs + continuation labels — Stage 1B/1D |
| Place-name index | Derived from saved important locations + landmarks — Stage 2C / Stage 6 |
| Mileage / how-much-longer | Route length + scale engine — Stage 6 routes + Standard Scale Presets |
| Legend / key | Page-furniture legend stub — Stage 1D |

## The Key Difference From A Military Grid

A road-atlas grid is **page-relative and arbitrary** (its A1/B2 means nothing off that page). A UTM/MGRS grid is **georeferenced and universal** (a coordinate is globally unique and metric). Level 1 deliberately uses the friendly page-relative grid; the learning curve's job is to walk a kid from "page-relative square" to "real-world coordinate." See [[Progressive Map Skills Curriculum]] and [[MGRS USNG Map Acquisition]].

See also: [[Progressive Map Skills Curriculum]], [[Land Nav Learning Curve Recommendation]], [[Staged Build Roadmap]], [[Branding Theme]]
