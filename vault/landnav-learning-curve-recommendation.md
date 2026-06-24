---
title: "Land Nav Learning Curve Recommendation"
category: "recommendation"
status: researched
priority: high
related:
  - "Captain Input — Road Atlas vs Land Nav"
  - "Progressive Map Skills Curriculum"
  - "Orienteering Course Levels As Scaffold"
  - "Road Atlas Conventions"
  - "MGRS USNG Map Acquisition"
  - "Staged Build Roadmap"
  - "Branding Theme"
  - "Open Questions"
  - "TC 3-25.26 Part 1 Map Reading and Land Navigation"
source_urls:
  - "https://armypubs.army.mil/ProductMaps/PubForm/Details.aspx?PUB_ID=103749"
  - "https://www.bko.org.uk/sites/default/files/basicpage/KYS-Colour-Coded-Courses.pdf"
  - "https://www.usgs.gov/faqs/do-all-usgs-75-minute-topographic-maps-show-utm-grid"
  - "https://www.fgdc.gov/usng/how-to-read-usng"
---

# Land Nav Learning Curve Recommendation

This is the synthesis answering the core tension from [[Captain Input — Road Atlas vs Land Nav]]: should Journey Book be a road atlas, or a deliberate land-nav learning curve?

## Recommendation: Road-Atlas-First, Land-Nav-Capable

**Ship a road-atlas-first product whose default page is Level 1, with the Army land-nav concepts available as opt-in, progressively-unlockable tiers — not as the starting point.** It is not road-atlas *vs* land-nav; the road atlas *is* the first rung of the land-nav ladder.

Rationale:
1. **It answers the real job first.** The daughters' task is "find where we are" and "how much longer." A road atlas (Level 1) answers that on day one with zero learning curve. See [[Road Atlas Conventions]].
2. **It honors the owner's own worry.** He said MGRS "speaks a different language" and is "a learning curve." Leading with MGRS would overwhelm a 5–8 year old. Leading with a friendly grid and *adding* rigor matches both the school-age evidence and the orienteering progression. See [[Progressive Map Skills Curriculum]] and [[Orienteering Course Levels As Scaffold]].
3. **The curve is real, not abandoned.** Because each tier is additive page furniture on one engine, the same book grows with the kids — Level 1 today, Level 4 (full MGRS, azimuths, declination, [[TC 3-25.26 Part 1 Map Reading and Land Navigation]]) by their teens. The hiking-trip ambition is preserved.
4. **The acquisition blocker dissolves.** "How do I get MGRS maps" is answered by **generating our own USNG grid** over any basemap (see [[MGRS USNG Map Acquisition]]) — so the advanced tiers cost an overlay, not a map-sourcing pipeline.

## Which Tier Is The MVP Default

**Level 1 (road-atlas grid) is the MVP default**, with **Level 2 (scale bar + compass)** as a near-term fast-follow because the engine already produces a true measured scale bar (Stage 1D/1E of [[Staged Build Roadmap]]) — Level 2 is almost free. Levels 3 (UTM/USNG) and 4 (full MGRS) are **opt-in advanced templates**, gated behind a toggle, targeted at older kids and the hiking use case.

## USNG vs MGRS Labeling For Kids

**Label the grid "USNG" by default, with "(Army calls it MGRS)" as a note.** USNG and MGRS are mathematically identical within the U.S.; USNG is the civilian/emergency-management name and reads as friendlier and less martial — which aligns with the [[Branding Theme]] guardrail "do not make the product look like military software." Surface the MGRS name only in the Level 4 advanced template where the TC 3-25.26 vocabulary is the point.

## How This Reshapes The Roadmap

This recommendation is mostly an **emphasis and sequencing change**, not new architecture — the engine already supports it:

- **Default product framing → road-atlas-first.** Update the open product question in [[Open Questions]] ("road-trip vs hiking vs school-route") toward: road-trip road-atlas is the default surface; hiking/land-nav are the advanced tiers of the same engine.
- **Introduce explicit "Levels" as a first-class concept** alongside Standard Scale Presets. A page (or book) has a **level/tier** that selects which page furniture is drawn. This belongs in the page-furniture contract (Stage 1D) and the project metadata (Stage 2A) so it round-trips like scale preset does.
- **Stage 6B "Land-Nav Fidelity Pass" gets sharper.** Its "advanced land-nav template toggle" and "UTM/MGRS overlay spike" become the concrete **Level 3 and Level 4 templates**, and the spike's outcome is pre-decided: **generate our own USNG/MGRS grid** (per [[MGRS USNG Map Acquisition]]) rather than sourcing pre-made military maps. The marginal-information review in 6B becomes the progressive scaffold (key→legend→full TC 3-25.26 margins) across Levels 1→4.
- **Doctrine source of truth → APD.** Cite TC 3-25.26 from **armypubs.army.mil (PUB_ID 103749)**, not the armywriter.com PDF, per the captain. US Army doctrine is public domain, so the concepts can be embedded directly in challenge pages.
- **No change to the risk-first/headless-first build order.** Levels are page furniture; they layer onto the proven engine after Stage 1, exactly where Stage 6B already sits.

## One-Line Answer

Build the road atlas the girls need now; make it the bottom rung of a land-nav ladder they can climb for years.

See also: [[Captain Input — Road Atlas vs Land Nav]], [[Progressive Map Skills Curriculum]], [[Orienteering Course Levels As Scaffold]], [[Road Atlas Conventions]], [[MGRS USNG Map Acquisition]], [[Staged Build Roadmap]], [[Branding Theme]], [[Open Questions]], [[TC 3-25.26 Part 1 Map Reading and Land Navigation]]
