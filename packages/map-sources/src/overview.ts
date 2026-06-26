import type { AtlasOverview, AtlasPage, BBox, LngLat, PinStyle } from "@journeybook/atlas-core";
import { lngLatToPanelFraction } from "./tilemath.js";

export interface BuildOverviewOptions {
  /** Padding around the union extent, as a fraction of the span (default 0.08). */
  pad?: number;
  /** Optional route polyline (LngLat) drawn across the overview. */
  route?: LngLat[];
  /** Optional stop markers (saved locations) with labels and custom pins. */
  stops?: { center: LngLat; label: string; pin?: PinStyle }[];
}

/**
 * Build the whole-atlas index/overview: the union extent of every page plus each
 * page's rectangle (and the route/stops) in normalized [0,1] coordinates, using
 * the same Web-Mercator panel mapping the basemap uses — so the rectangles
 * register with an overview basemap fetched for {@link AtlasOverview.bbox}.
 */
export function buildAtlasOverview(pages: AtlasPage[], opts: BuildOverviewOptions = {}): AtlasOverview {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of pages) {
    const [pw, ps, pe, pn] = p.bbox;
    w = Math.min(w, pw);
    s = Math.min(s, ps);
    e = Math.max(e, pe);
    n = Math.max(n, pn);
  }

  const pad = opts.pad ?? 0.08;
  const padX = Math.max((e - w) * pad, 0.01);
  const padY = Math.max((n - s) * pad, 0.01);
  const bbox: BBox = [w - padX, s - padY, e + padX, n + padY];

  const frac = (point: LngLat): [number, number] => lngLatToPanelFraction(point, bbox);

  const pageRects = pages.map((p) => {
    const [bw, bs, be, bn] = p.bbox;
    const [x1, y1] = frac({ lng: bw, lat: bn }); // top-left
    const [x2, y2] = frac({ lng: be, lat: bs }); // bottom-right
    return { id: p.id, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  });

  const route = opts.route?.map((pt) => {
    const [x, y] = frac(pt);
    return { x, y };
  });
  const stops = opts.stops?.map((st) => {
    const [x, y] = frac(st.center);
    return { x, y, label: st.label, ...(st.pin ? { pin: st.pin } : {}) };
  });

  return {
    bbox,
    pages: pageRects,
    ...(route && route.length > 0 ? { route } : {}),
    ...(stops && stops.length > 0 ? { stops } : {}),
  };
}
