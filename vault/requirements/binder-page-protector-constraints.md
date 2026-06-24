---
title: "Binder Page Protector Constraints"
category: "requirements"
status: researched
priority: medium
related:
  - "Print-Safe Margins"
  - "Margin Bleed Trimming Lamination"
  - "Exact Letter Page Sizing"
source_urls:
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page/size"
---

# Binder Page Protector Constraints

Binder-ready pages need room for hole punches, page protector seams, and fingers. A map that runs too close to the left edge may be hard to read in a binder.

The app should support an inside gutter setting. For single-sided portrait pages, reserve more space on the left. For duplex printing, alternate inside margins by odd/even page.

Page protectors add glare and soften fine detail, so line weights, route colors, contour labels, and text sizes should be tested through plastic, not only on a screen.

See also: [[Print-Safe Margins]], [[Margin Bleed Trimming Lamination]], [[Exact Letter Page Sizing]]
