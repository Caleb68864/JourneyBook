---
title: "Open Questions"
category: "summary"
status: researched
priority: medium
related:
  - "Recommended Stack"
  - "License Summary"
  - "Offline Map Storage"
  - "Landmark Selection"
  - "Android Atlas App"
source_urls:
  - "https://operations.osmfoundation.org/policies/tiles/"
  - "https://docs.protomaps.com/pmtiles/"
  - "https://apps.nationalmap.gov/services/"
  - "https://openrouteservice.org/restrictions/"
  - "https://react-pdf.org/"
  - "https://www.questpdf.com/license/community.html"
  - "https://developer.android.com/guide"
---

# Open Questions

## Product Questions
- Should Journey Book default to road-trip atlases, hiking atlases, or school-route atlases?
- Should the first version be parent-created only, or should kids choose challenges?
- Should route pages be rectangular grid pages or route-corridor pages?
- For Android later, should the primary mode feel like a scrollable atlas page grid, with a conventional map mode as a secondary tool?
- Road-atlas-first vs land-nav-first: should the default page be a familiar road-atlas grid (Level 1) that progressively builds toward Army land nav, or should we lead with the military grid? (Recommendation: road-atlas-first — see [[Land Nav Learning Curve Recommendation]].)
- Which tier is the MVP default — Level 1 (road-atlas grid) only, or Level 1 + the nearly-free Level 2 (scale bar + compass)? See [[Progressive Map Skills Curriculum]].
- For the metric grid, do we label it "USNG" (civilian, kid-friendly) or "MGRS" (military) by default? They are mathematically identical in the U.S. See [[MGRS USNG Map Acquisition]].

## Technical Questions
- Which map source will legally support offline packaged regions for the intended use?
- Is browser PDF output precise enough for scale-sensitive pages?
- Should final composition be client-side React PDF, browser print/export, QuestPDF server-side fallback, or a hybrid?
- What minimum contour readability survives home printers and page protectors?
- Should Android render atlas pages natively from metadata, reuse PDF/page images, or support both?

## Legal Questions
- Will the app ever be commercial? If yes, tile provider choices need another review.
- Can generated atlases be shared publicly, or are they personal-use exports?
- Which attribution footer is required for each selected layer mix?

See also: [[Recommended Stack]], [[License Summary]], [[Offline Map Storage]], [[Landmark Selection]], [[Android Atlas App]]
