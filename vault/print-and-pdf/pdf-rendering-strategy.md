---
title: "PDF Rendering Strategy"
category: "print-and-pdf"
status: researched
priority: high
related:
  - "Recommended Stack"
  - "Staged Build Roadmap"
  - "React"
  - "QuestPDF"
  - "Exact Letter Page Sizing"
source_urls:
  - "https://react-pdf.org/"
  - "https://www.npmjs.com/package/%40react-pdf/renderer"
  - "https://questpdf.com/"
  - "https://www.questpdf.com/license/community.html"
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page/size"
---

# PDF Rendering Strategy

Journey Book should prefer a React/client-side PDF workflow if it can produce excellent printed output. The UI, preview, and generated atlas pages should share as much layout logic as possible so the user sees the same page structure before export.

## Preferred Path

Use React to compose atlas pages and generate PDFs client-side when the result is crisp, correctly sized, and reliable. Candidate approaches:
- React page components rendered into print/PDF-specific layout.
- `@react-pdf/renderer` for React-driven PDF creation in the browser or server.
- Browser print/export from controlled React page layouts if exact Letter sizing and map rendering stay reliable.

The key test is not whether the library can make a PDF; it is whether maps, labels, scale bars, attribution, and page-to-page alignment remain print-quality.

## Important Constraint

MapLibre/WebGL map previews may not translate directly into React PDF primitives. If the client-side path struggles with vector maps or high-resolution atlas pages, render map panels as images/canvas outputs and place them into the PDF layout, or move final composition to a server renderer.

## Server Fallback

QuestPDF is the preferred server-side fallback if client-side React PDFs do not look good enough. It is a C# code-first PDF library designed for precise document generation.

QuestPDF has a hybrid license. As of the cited 2026 license page, it is free for individuals, charitable organizations, academic institutions, FOSS projects, and businesses with less than USD 1,000,000 in annual revenue. Re-check the license before commercial release or if the project grows.

## Decision Rule

Prototype the client-side React PDF path first. Keep QuestPDF behind a clean rendering contract so switching the final PDF engine does not rewrite project data, page-grid logic, or the atlas preview.

See also: [[Recommended Stack]], [[Staged Build Roadmap]], [[React]], [[QuestPDF]], [[Exact Letter Page Sizing]]
