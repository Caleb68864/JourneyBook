import type { JSX, ReactNode } from "react";
import { ContourField, CompassRose, ScaleBar, PageChip } from "./MapFurniture";
import { HealthChip } from "./HealthChip";

/**
 * Journey Book landing hero.
 *
 * Thesis: the page IS a map sheet. The headline lives inside a real neatline
 * (double-rule border) with corner grid-coordinate ticks, page-ID wayfinding,
 * a measured scale bar, and a survey compass rose — the same marginalia the
 * product prints onto every atlas page. The contour field bleeds behind it.
 * Field guide meets junior-ranger packet; rugged, calm, never childish.
 */

interface Feature {
  chip: string;
  title: string;
  body: string;
  icon: (cls: string) => JSX.Element;
}

const FEATURES: Feature[] = [
  {
    chip: "S1",
    title: "Choose your scale",
    body: "Pick a real preset — 7.5-minute, 1:24,000, 1:50,000 — and every page covers the same true ground area.",
    icon: (cls) => (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="9" width="18" height="6" />
        <path d="M7 9v6M11 9v4M15 9v6M19 9v4" />
      </svg>
    ),
  },
  {
    chip: "P2",
    title: "True-to-scale pages",
    body: "Each sheet reprojects to a local datum so the printed scale bar measures right against a real ruler.",
    icon: (cls) => (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M4 4h16v16H4z" />
        <path d="M4 9h3M4 14h3M9 20v-3M14 20v-3M20 9h-3M20 14h-3M9 4v3M14 4v3" />
      </svg>
    ),
  },
  {
    chip: "L3",
    title: "Landmarks & routes",
    body: "Mark Grandma's house, the trailhead, the lookout — saved spots get their own labeled, same-scale page.",
    icon: (cls) => (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M12 21c4.5-5 7-8.4 7-11a7 7 0 1 0-14 0c0 2.6 2.5 6 7 11Z" />
        <circle cx="12" cy="10" r="2.4" />
      </svg>
    ),
  },
  {
    chip: "G4",
    title: "Compass-ready grid",
    body: "North-up pages with neighbor labels — CONTINUE NORTH TO A2 — so a paper book navigates like a road atlas.",
    icon: (cls) => (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <polygon points="12,5 14,12 12,11 10,12" fill="currentColor" stroke="none" />
        <polygon points="12,19 14,12 12,13 10,12" fill="currentColor" opacity="0.5" stroke="none" />
      </svg>
    ),
  },
];

export function Hero() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-parchment-200 text-charcoal-900">
      {/* Topographic field — paper texture, bark ink, very low contrast */}
      <ContourField className="pointer-events-none absolute inset-0 h-full w-full text-bark-600 opacity-[0.13]" />
      {/* Hairline grid graticule overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-forest-700) 1px, transparent 1px), linear-gradient(90deg, var(--color-forest-700) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
        {/* Masthead — runs like the top margin of a sheet */}
        <header className="flex items-center justify-between gap-4 animate-rise" style={{ animationDelay: "0ms" }}>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg leading-none text-forest-700 sm:text-xl">JOURNEY BOOK</span>
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-bark-600 sm:inline">
              Field Atlas Press
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <PageChip id="A1" />
            <PageChip id="A2" className="opacity-55" />
            <PageChip id="A3" className="opacity-30" />
          </nav>
        </header>

        {/* The sheet — neatline framing the hero content */}
        <main className="relative mt-6 flex-1">
          <Sheet>
            <div className="grid items-center gap-10 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[1.25fr_0.75fr] lg:gap-6">
              {/* Left column — the title block of the sheet */}
              <div>
                <p
                  className="animate-rise font-mono text-xs uppercase tracking-[0.22em] text-campfire-600"
                  style={{ animationDelay: "80ms" }}
                >
                  Printable adventure atlases
                </p>

                <h1
                  className="animate-rise mt-4 font-display text-5xl leading-[0.95] text-forest-700 sm:text-6xl lg:text-7xl"
                  style={{ animationDelay: "140ms" }}
                >
                  Turn any spot
                  <br />
                  into a book you
                  <br />
                  <span className="text-campfire-600">can navigate.</span>
                </h1>

                <p
                  className="animate-rise mt-6 max-w-xl text-lg leading-relaxed text-charcoal-700"
                  style={{ animationDelay: "200ms" }}
                >
                  Journey Book turns a bounding box or your saved places into a true-to-scale,
                  north-up atlas — page grids, a real scale bar, compass roses, and landmark
                  labels — ready to print and hand to a young explorer with a pencil and a compass.
                </p>

                <div
                  className="animate-rise mt-8 flex flex-wrap items-center gap-3"
                  style={{ animationDelay: "260ms" }}
                >
                  <a
                    href="#start"
                    className="group inline-flex items-center gap-2 bg-forest-700 px-6 py-3 font-display text-base tracking-wide text-cream-50 shadow-[3px_3px_0_0_var(--color-bark-700)] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:bg-forest-600 hover:shadow-[2px_2px_0_0_var(--color-bark-700)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-campfire-500"
                  >
                    Start an atlas
                    <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </a>
                  <a
                    href="#how"
                    className="inline-flex items-center gap-2 border-2 border-bark-700 bg-cream-50 px-6 py-3 font-display text-base tracking-wide text-bark-700 transition-colors hover:bg-parchment-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-700"
                  >
                    See how it works
                  </a>
                </div>

                <div className="animate-rise mt-9" style={{ animationDelay: "320ms" }}>
                  <ScaleBar />
                </div>
              </div>

              {/* Right column — the map panel inset with compass + locator */}
              <div className="relative animate-rise" style={{ animationDelay: "240ms" }}>
                <div className="relative mx-auto aspect-square w-full max-w-sm border-2 border-bark-700 bg-cream-50/70 p-5 shadow-[5px_5px_0_0_rgba(74,54,31,0.25)]">
                  <span className="absolute -top-3 left-4 bg-parchment-200 px-2 font-mono text-[10px] uppercase tracking-widest text-bark-600">
                    True North
                  </span>
                  <CompassRose className="h-full w-full text-forest-700" />
                  <span className="absolute -bottom-3 right-4 bg-parchment-200 px-2 font-mono text-[10px] uppercase tracking-widest text-bark-600">
                    Declination 9° E
                  </span>
                </div>
              </div>
            </div>
          </Sheet>
        </main>

        {/* Feature strip — the legend along the foot of the sheet */}
        <section
          id="how"
          className="animate-rise mt-7 grid gap-px overflow-hidden border border-bark-400/50 bg-bark-400/40 sm:grid-cols-2 lg:grid-cols-4"
          style={{ animationDelay: "380ms" }}
          aria-label="What Journey Book does"
        >
          {FEATURES.map((f) => (
            <article key={f.chip} className="group flex flex-col gap-3 bg-cream-100 p-5 transition-colors hover:bg-cream-50">
              <div className="flex items-center justify-between">
                <span className="text-moss-600 transition-colors group-hover:text-forest-700">{f.icon("h-7 w-7")}</span>
                <PageChip id={f.chip} />
              </div>
              <h3 className="font-display text-base leading-tight text-forest-700">{f.title}</h3>
              <p className="text-sm leading-relaxed text-charcoal-700">{f.body}</p>
            </article>
          ))}
        </section>

        {/* Footer margin — attribution row + live service readout */}
        <footer
          id="start"
          className="animate-rise mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-bark-400/50 pt-4 font-mono text-[11px] text-bark-600"
          style={{ animationDelay: "440ms" }}
        >
          <span className="uppercase tracking-wider">Journey Book · single-user MVP · Letter, north-up</span>
          <HealthChip />
        </footer>
      </div>
    </div>
  );
}

/**
 * Neatline sheet wrapper — the double-rule border of a topo map with surveyed
 * corner coordinate ticks. This frame is the page's signature: it makes the
 * hero read as a printed atlas sheet rather than a generic centered hero.
 */
function Sheet({ children }: { children: ReactNode }) {
  const corners: Array<{ pos: string; label: string }> = [
    { pos: "left-2 top-2", label: "41°16′N" },
    { pos: "right-2 top-2 text-right", label: "96°02′W" },
    { pos: "left-2 bottom-2", label: "41°13′N" },
    { pos: "right-2 bottom-2 text-right", label: "95°58′W" },
  ];
  return (
    <div className="relative border-[3px] border-double border-forest-700 bg-cream-100/80 shadow-[0_2px_0_0_var(--color-bark-700)]">
      {/* inner hairline rule = the second line of the neatline */}
      <div className="pointer-events-none absolute inset-1.5 border border-bark-400/50" aria-hidden="true" />
      {corners.map((c) => (
        <span
          key={c.pos}
          className={`pointer-events-none absolute ${c.pos} font-mono text-[9px] tracking-tight text-bark-600/80`}
          aria-hidden="true"
        >
          {c.label}
        </span>
      ))}
      {children}
    </div>
  );
}
