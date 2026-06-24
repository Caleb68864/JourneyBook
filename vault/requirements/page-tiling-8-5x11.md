---
title: "Page Tiling 8.5x11"
category: "requirements"
status: researched
priority: high
related:
  - "Printable Atlas Generation"
  - "Splitting Extent Into Pages"
  - "Print-Safe Margins"
source_urls:
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page/size"
  - "https://www.w3.org/TR/css-page-3/"
---

# Page Tiling 8.5x11

Letter paper is 8.5 x 11 inches. The atlas should reserve margins and page furniture, then compute the remaining map viewport as the true tiling unit.

Portrait and landscape layouts must not be afterthoughts. A portrait page has more north/south reach; landscape has more east/west reach. The same selected extent may produce different row/column counts depending on orientation.

For home printing, assume a conservative 0.25 inch safe margin unless the app offers a calibration mode. Binder holes and page protectors may require a larger inside margin.

See also: [[Printable Atlas Generation]], [[Splitting Extent Into Pages]], [[Print-Safe Margins]]
