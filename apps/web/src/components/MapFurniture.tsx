/**
 * Map-furniture primitives — the marginal apparatus of a real topo sheet,
 * rebuilt as inline SVG so the landing page is framed like one of the atlas
 * pages the product generates. No icon libraries; everything is hand-drawn
 * paths tuned to the brand palette (forest ink, bark rules, campfire accent).
 */

/**
 * Faint topographic contour field. Concentric, hand-massaged closed curves
 * suggesting two hills and a saddle — drawn in bark at low opacity so it reads
 * as paper texture, never as decoration competing with the type.
 */
export function ContourField({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      fill="none"
    >
      <g stroke="currentColor" strokeWidth="1.4" fill="none">
        {/* East hill — five nested rings */}
        <path d="M905 250 C1010 235 1095 300 1085 385 C1078 460 985 505 895 480 C815 458 775 380 805 315 C828 268 862 257 905 250 Z" />
        <path d="M905 290 C985 280 1048 330 1042 392 C1036 450 968 482 902 463 C842 446 812 388 833 338 C851 302 875 294 905 290 Z" />
        <path d="M905 328 C962 322 1004 357 1000 398 C996 436 950 458 905 446 C865 435 845 398 860 363 C873 338 884 330 905 328 Z" />
        <path d="M905 363 C942 360 968 382 966 405 C963 429 934 442 906 435 C882 429 871 405 880 384 C888 368 893 364 905 363 Z" />
        <path d="M903 393 C924 392 938 403 937 416 C935 430 919 437 903 433 C889 430 883 416 888 404 C893 396 896 393 903 393 Z" />

        {/* West hill — four nested rings, slightly elongated */}
        <path d="M250 430 C355 405 470 445 478 535 C485 620 400 690 295 678 C205 668 130 600 145 515 C158 452 195 443 250 430 Z" />
        <path d="M270 470 C355 452 442 488 448 555 C453 618 388 666 305 656 C232 648 178 596 192 535 C204 487 230 480 270 470 Z" />
        <path d="M290 510 C355 498 418 526 422 575 C426 620 380 652 320 644 C265 638 228 600 240 558 C250 522 268 516 290 510 Z" />
        <path d="M310 550 C355 543 388 564 390 596 C392 626 362 646 322 640 C288 636 268 612 277 585 C285 562 296 553 310 550 Z" />

        {/* Saddle / drainage line threading between the two hills */}
        <path d="M470 540 C560 470 640 470 720 410" strokeDasharray="2 7" opacity="0.8" />
      </g>
    </svg>
  );
}

/**
 * Survey-grade compass rose. True-north arrow in campfire orange (the product's
 * route/active accent), 32-tick bezel, cardinal stencil letters via <text>.
 */
export function CompassRose({ className }: { className?: string }) {
  const ticks = Array.from({ length: 32 }, (_, i) => i);
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Compass rose pointing to true north"
      fill="none"
    >
      <circle cx="100" cy="100" r="92" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <circle cx="100" cy="100" r="80" stroke="currentColor" strokeWidth="2.5" />
      {ticks.map((i) => {
        const major = i % 8 === 0;
        const mid = i % 4 === 0;
        const len = major ? 16 : mid ? 11 : 6;
        const a = (i / 32) * Math.PI * 2;
        const r1 = 80;
        const r2 = 80 - len;
        return (
          <line
            key={i}
            x1={100 + Math.sin(a) * r1}
            y1={100 - Math.cos(a) * r1}
            x2={100 + Math.sin(a) * r2}
            y2={100 - Math.cos(a) * r2}
            stroke="currentColor"
            strokeWidth={major ? 2.4 : 1.2}
          />
        );
      })}
      {/* Needle — north half filled with campfire accent, south hollow */}
      <g className="animate-needle">
        <polygon points="100,28 112,100 100,86 88,100" fill="var(--color-campfire-500)" />
        <polygon points="100,172 112,100 100,114 88,100" fill="currentColor" opacity="0.85" />
        <circle cx="100" cy="100" r="6" fill="var(--color-cream-50)" stroke="currentColor" strokeWidth="2" />
      </g>
      <text x="100" y="20" textAnchor="middle" className="fill-current" style={{ font: "700 16px var(--font-display)" }}>
        N
      </text>
      <text x="186" y="106" textAnchor="middle" className="fill-current" style={{ font: "400 12px var(--font-mono)" }}>
        E
      </text>
      <text x="100" y="195" textAnchor="middle" className="fill-current" style={{ font: "400 12px var(--font-mono)" }}>
        S
      </text>
      <text x="14" y="106" textAnchor="middle" className="fill-current" style={{ font: "400 12px var(--font-mono)" }}>
        W
      </text>
    </svg>
  );
}

/**
 * A measured scale bar — the single most load-bearing piece of map furniture
 * in the product ("true scale" is the headline engineering risk). Alternating
 * bark/parchment segments with a mono numeric readout, exactly like a printed
 * page margin.
 */
export function ScaleBar({ className }: { className?: string }) {
  const segments = [0, 1, 2, 3];
  return (
    <div className={className}>
      <div className="flex items-end gap-3">
        <div>
          <div className="flex h-3 w-44 border border-bark-700">
            {segments.map((i) => (
              <div
                key={i}
                className={`flex-1 ${i % 2 === 0 ? "bg-bark-700" : "bg-cream-50"} ${
                  i > 0 ? "border-l border-bark-700" : ""
                }`}
              />
            ))}
          </div>
          <div className="mt-1 flex w-44 justify-between font-mono text-[10px] tracking-tight text-bark-700">
            <span>0</span>
            <span>1</span>
            <span>2 mi</span>
          </div>
        </div>
        <span className="pb-3 font-mono text-[11px] uppercase tracking-wider text-bark-600">1:24,000</span>
      </div>
    </div>
  );
}

/** Stencil page-ID chip (A1, B2…) — the atlas wayfinding token. */
export function PageChip({ id, className = "" }: { id: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center border-2 border-forest-700 bg-cream-50 px-2 py-0.5 font-display text-xs leading-none text-forest-700 ${className}`}
    >
      {id}
    </span>
  );
}
