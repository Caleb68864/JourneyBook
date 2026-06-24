---
title: "Accepting Bounding Boxes"
category: "grid-system"
status: researched
priority: high
related:
  - "Printable Atlas Generation"
  - "Custom Page Grid"
source_urls:
  - "https://epsg.io/4326"
---

# Accepting Bounding Boxes

Bounding boxes are the cleanest MVP input. Store them as west/south/east/north in WGS84, validate min/max ordering, and reject boxes that cross unsupported projection edges until that case is designed.

See also: [[Printable Atlas Generation]], [[Custom Page Grid]]
