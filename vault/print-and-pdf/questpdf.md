---
title: "QuestPDF"
category: "print-and-pdf"
status: researched
priority: medium
related:
  - "PDF Rendering Strategy"
  - "Exact Letter Page Sizing"
source_urls:
  - "https://questpdf.com/"
  - "https://www.questpdf.com/quick-start.html"
  - "https://www.questpdf.com/license/community.html"
  - "https://www.questpdf.com/license/guide.html"
---

# QuestPDF

## What It Does

QuestPDF is a C# code-first PDF generation library for precise document layouts. It is a strong fallback for Journey Book if client-side React PDF generation cannot produce crisp, reliable Letter-size atlas pages.

## License

QuestPDF uses a hybrid license. The 2026 Community License page says it is free for individuals, charitable organizations, academic institutions, FOSS projects, and businesses with less than USD 1,000,000 in annual revenue. Organizations outside the community terms need a paid license.

## Best Fit

Use QuestPDF for server-side rendering if the atlas needs deterministic page composition, exact page geometry, or better print fidelity than browser/client-side PDF generation can provide.

## Problems

It adds a .NET/C# service to the Docker stack unless the backend is already .NET. Its license must be reviewed before commercial release. It also means the React preview and PDF output need a shared layout contract to avoid drift.

## MVP Role

Do not start with QuestPDF unless client-side rendering fails early. Keep it as a planned fallback and design the page-grid/page-furniture model so QuestPDF can consume the same metadata later.

See also: [[PDF Rendering Strategy]], [[Exact Letter Page Sizing]]
