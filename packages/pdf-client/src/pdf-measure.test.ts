import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { largestRect, mapBoxOf, measurePdfPages } from "./pdf-measure.js";

/**
 * The instrument, on its own bench.
 *
 * Every true-scale claim this repo makes is a number this module read off a
 * PDF — the 415 x 549 pt map box, the scale bar's printed length, the 1-inch
 * calibration tick, and now `validateAtlas`'s `printed-scale-fidelity` check.
 * Until now its `cm` composition, its `Do` unit-square transform, its y-flip and
 * its hex-string decoder were exercised only incidentally, by the tests that
 * depend on them already being right. A measuring instrument verified only
 * through the measurements it produces is not verified: a transposed matrix or a
 * dropped flip would move every reading together, and every downstream test
 * would keep agreeing with itself.
 *
 * These pages are written by hand, so the right answer is known before the
 * parser runs.
 */

/**
 * The smallest thing `measurePdfPages` will accept: a deflated content stream
 * that opens with react-pdf's y-flip matrix, which is how it recognises a page.
 */
function pageStream(content: string, pageHeight = 800): Buffer {
  const body = deflateSync(Buffer.from(`1 0 0 -1 0 ${pageHeight} cm\n${content}`, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.7\nstream\n", "latin1"),
    body,
    Buffer.from("endstream\n%%EOF\n", "latin1"),
  ]);
}

function measureOne(content: string, pageHeight = 800) {
  const pages = measurePdfPages(pageStream(content, pageHeight));
  expect(pages).toHaveLength(1);
  return pages[0]!;
}

describe("pdf-measure y-flip", () => {
  it("reports a rectangle in top-left page coordinates", () => {
    // PDF user space is y-up from the bottom-left; react-pdf's leading matrix
    // flips it. A reading must come back as the layout was written: 20 pt down
    // from the top of the page, not 730 pt up from the bottom.
    const page = measureOne("10 20 100 50 re\nf");
    expect(page.rects).toHaveLength(1);
    expect(page.rects[0]).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("measures against the page height it found, not a fixed one", () => {
    const short = measureOne("10 20 100 50 re\nf", 400);
    expect(short.rects[0]).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("reports a straight segment with both endpoints flipped", () => {
    const page = measureOne("10 10 m\n10 110 l\nS");
    expect(page.lines).toEqual([{ x1: 10, y1: 10, x2: 10, y2: 110 }]);
  });
});

describe("pdf-measure cm composition", () => {
  it("applies the graphics-state matrix to a rectangle, and pops it at Q", () => {
    // A 10x10 unit rect scaled 2x and moved to (30, 40) is a 20x20 box there;
    // after Q the same coordinates mean what they did before the q.
    const page = measureOne("q\n2 0 0 2 30 40 cm\n0 0 10 10 re\nf\nQ\n0 0 5 5 re\nf");
    expect(page.rects).toEqual([
      { x: 30, y: 40, width: 20, height: 20 },
      { x: 0, y: 0, width: 5, height: 5 },
    ]);
  });

  it("composes nested matrices in the right order", () => {
    // Translate then scale is not scale then translate. Inner-first: (1,1) →
    // scale 3 → (3,3) → translate (10,20) → (13,23); the 1x1 rect is 3x3 at
    // (10,20). A transposed or reversed multiply lands it at (31, 61) instead.
    const page = measureOne("q\n1 0 0 1 10 20 cm\n3 0 0 3 0 0 cm\n1 1 1 1 re\nf\nQ");
    expect(page.rects).toEqual([{ x: 13, y: 23, width: 3, height: 3 }]);
  });

  it("does not leak a matrix past an unbalanced Q", () => {
    const page = measureOne("q\n5 0 0 5 0 0 cm\nQ\n0 0 4 4 re\nf");
    expect(page.rects).toEqual([{ x: 0, y: 0, width: 4, height: 4 }]);
  });
});

describe("pdf-measure Do", () => {
  it("takes the CTM's scale factors as the drawn size of an image", () => {
    // `/Name Do` paints the XObject over the unit square, so the placement is
    // entirely in the matrix — there are no operands to read.
    const page = measureOne("q\n200 0 0 300 50 400 cm\n/X0 Do\nQ");
    expect(page.images).toEqual([{ x: 50, y: 400, width: 200, height: 300 }]);
    expect(page.rects).toHaveLength(0);
  });

  it("handles the negative-d matrix an image placement usually carries", () => {
    // d < 0 flips the image's own y; the drawn box is the same box either way.
    const page = measureOne("q\n200 0 0 -300 50 100 cm\n/X0 Do\nQ");
    expect(page.images).toHaveLength(1);
    expect(page.images[0]!.width).toBe(200);
    expect(page.images[0]!.height).toBe(300);
  });
});

describe("pdf-measure text", () => {
  it("decodes the hex strings pdfkit writes for the standard-14 fonts", () => {
    const page = measureOne("BT\n<48656C6C6F> Tj\nET");
    expect(page.texts).toEqual(["Hello"]);
  });

  it("decodes an odd-spaced hex string the same way", () => {
    const page = measureOne("BT\n<48 65 6C 6C 6F> Tj\nET");
    expect(page.texts).toEqual(["Hello"]);
  });

  it("reads a literal string, honouring escaped parentheses", () => {
    const page = measureOne("BT\n(A\\(B\\)C) Tj\nET");
    expect(page.texts).toEqual(["A(B)C"]);
  });

  it("joins the pieces of a TJ array into one shown string", () => {
    const page = measureOne("BT\n[<48> <69>] TJ\nET");
    expect(page.texts).toEqual(["Hi"]);
  });
});

/**
 * Where a string landed, not just that it was shown.
 *
 * "The words are in the file" is not a claim about the printed page: @react-pdf
 * paints a line that does not fit a fixed-height block anyway, outside the block,
 * and nothing fails. The baseline is the only thing that tells the two apart, so
 * it is read here on hand-written pages where the answer is known in advance.
 */
describe("pdf-measure text placement", () => {
  it("reports the baseline a Tm put the string on, in top-down coordinates", () => {
    // `pageStream` opens with react-pdf's flip, so the stream's own coordinates
    // already read downward from the top: a baseline at Tm y=700 is 700 pt down.
    // Reading it as 100 (the y-UP distance from the foot of an 800 pt sheet)
    // would put every footer line near the top of the page.
    const page = measureOne("BT\n1 0 0 1 40 700 Tm\n/F1 9 Tf\n<41> Tj\nET");
    expect(page.textItems).toEqual([{ text: "A", x: 40, y: 700, size: 9 }]);
  });

  it("carries the graphics-state matrix into the baseline", () => {
    // The furniture is drawn inside nested `cm` translations; a reading that
    // ignored the CTM would report the text at its block-relative origin.
    const page = measureOne("q\n1 0 0 1 10 20 cm\nBT\n1 0 0 1 5 700 Tm\n/F1 6 Tf\n<42> Tj\nET\nQ");
    expect(page.textItems).toEqual([{ text: "B", x: 15, y: 720, size: 6 }]);
  });

  it("advances the baseline for Td, relative to the line matrix", () => {
    const page = measureOne(
      "BT\n1 0 0 1 0 700 Tm\n/F1 8 Tf\n<41> Tj\n0 -12 Td\n<42> Tj\nET",
    );
    expect(page.textItems.map((t) => [t.text, t.y])).toEqual([
      ["A", 700],
      ["B", 688],
    ]);
  });

  it("resets the text matrix at each BT, so blocks do not accumulate", () => {
    const page = measureOne(
      "BT\n1 0 0 1 0 700 Tm\n/F1 8 Tf\n<41> Tj\nET\nBT\n1 0 0 1 0 600 Tm\n<42> Tj\nET",
    );
    expect(page.textItems.map((t) => t.y)).toEqual([700, 600]);
  });

  it("keeps the font size of the governing Tf", () => {
    const page = measureOne(
      "BT\n1 0 0 1 0 700 Tm\n/F1 11 Tf\n<41> Tj\n/F2 6 Tf\n<42> Tj\nET",
    );
    expect(page.textItems.map((t) => t.size)).toEqual([11, 6]);
  });

  it("keeps texts and textItems in step", () => {
    const page = measureOne("BT\n1 0 0 1 0 700 Tm\n/F1 9 Tf\n<48> Tj\n<69> Tj\nET");
    expect(page.texts).toEqual(page.textItems.map((t) => t.text));
  });
});

describe("pdf-measure path classification", () => {
  it("treats a closed four-corner axis-aligned subpath as a rectangle", () => {
    const page = measureOne("10 20 m\n110 20 l\n110 70 l\n10 70 l\n10 20 l\nh\nf");
    expect(page.rects).toEqual([{ x: 10, y: 20, width: 100, height: 50 }]);
  });

  it("tolerates the zero-length curves pdfkit emits for square joins", () => {
    const page = measureOne(
      "10 20 m\n110 20 l\n110 70 l\n110 70 110 70 110 70 c\n10 70 l\n10 20 l\nh\nf",
    );
    expect(page.rects).toEqual([{ x: 10, y: 20, width: 100, height: 50 }]);
  });

  it("does not call a genuinely curved subpath a rectangle", () => {
    const page = measureOne("10 20 m\n110 20 l\n110 70 40 90 10 70 c\n10 20 l\nh\nf");
    expect(page.rects).toHaveLength(0);
  });

  it("ignores a degenerate zero-area rectangle", () => {
    const page = measureOne("10 20 0 50 re\nf");
    expect(page.rects).toHaveLength(0);
  });
});

describe("measurePdfPages stream selection", () => {
  it("skips a stream that is not a page content stream", () => {
    // A font or image stream inflates fine but carries no leading flip matrix.
    const notAPage = deflateSync(Buffer.from("0 0 100 100 re f", "latin1"));
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.7\nstream\n", "latin1"),
      notAPage,
      Buffer.from("endstream\n", "latin1"),
      pageStream("10 20 100 50 re\nf").subarray("%PDF-1.7\n".length),
    ]);
    const pages = measurePdfPages(pdf);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.rects).toEqual([{ x: 10, y: 20, width: 100, height: 50 }]);
  });

  it("skips a stream that is not deflate at all, without throwing", () => {
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.7\nstream\nnot compressed at all\nendstream\n", "latin1"),
    ]);
    expect(measurePdfPages(pdf)).toEqual([]);
  });

  it("measures every page in a multi-page document", () => {
    const a = pageStream("10 20 100 50 re\nf");
    const b = pageStream("5 5 10 10 re\nf", 600);
    const pages = measurePdfPages(Buffer.concat([a, b]));
    expect(pages).toHaveLength(2);
    expect(pages[0]!.rects[0]!.width).toBe(100);
    expect(pages[1]!.rects[0]!.width).toBe(10);
  });
});

/**
 * Pages come back in DOCUMENT order, not file order.
 *
 * These are not the same thing, and the difference is not theoretical: react-pdf
 * writes a two-page document's content streams in either order, measured here at
 * roughly 50/50 across 25 renders. Every caller that maps `measured[i]` to
 * `contract.pages[i]` — `render-cli`'s `measurePrintedMapBoxes`, which feeds
 * `validateAtlas`'s printed-scale-fidelity check, and the per-page tests in
 * `print-resolution.test.ts` — was right by luck, and only because the pages it
 * compared carried identical geometry. The first test to give two otherwise
 * identical pages different text failed on one CI run and passed on the next.
 *
 * The fixtures below put the streams in the file in the OPPOSITE order to the
 * `/Kids` array, so file order and document order cannot both be right.
 */
describe("measurePdfPages document order", () => {
  /** `N 0 obj` wrapping a deflated page content stream. */
  function contentObject(num: number, content: string, pageHeight = 800): string {
    const body = deflateSync(Buffer.from(`1 0 0 -1 0 ${pageHeight} cm\n${content}`, "latin1"));
    return `${num} 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n${body.toString("latin1")}\nendstream\nendobj\n`;
  }

  /**
   * A two-page document whose content streams appear in the file in the reverse
   * of the order `/Kids` puts the pages in.
   */
  function reversedDoc(): Buffer {
    return Buffer.from(
      "%PDF-1.7\n" +
        // First in the FILE: the stream belonging to the SECOND page.
        contentObject(6, "10 20 100 50 re\nf") +
        contentObject(13, "5 5 10 10 re\nf") +
        "8 0 obj\n<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] /Contents 13 0 R >>\nendobj\n" +
        "15 0 obj\n<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>\nendobj\n" +
        "1 0 obj\n<< /Type /Pages /Count 2 /Kids [8 0 R 15 0 R] >>\nendobj\n" +
        "%%EOF\n",
      "latin1",
    );
  }

  it("returns pages in the order /Kids puts them, not the order the file stores them", () => {
    const pages = measurePdfPages(reversedDoc());
    expect(pages).toHaveLength(2);
    // /Kids is [8, 15]; page 8's /Contents is object 13, the 10x10 rect, which
    // is written SECOND in the file. File order would report 100 first.
    expect(pages[0]!.rects[0]!.width).toBe(10);
    expect(pages[1]!.rects[0]!.width).toBe(100);
  });

  it("falls back to file order for a document with no page tree", () => {
    // The hand-written fixtures above are bare streams. Reading nothing rather
    // than reading them wrongly is the whole point of the fallback.
    const a = pageStream("10 20 100 50 re\nf");
    const b = pageStream("5 5 10 10 re\nf", 600);
    const pages = measurePdfPages(Buffer.concat([a, b]));
    expect(pages.map((p) => p.rects[0]!.width)).toEqual([100, 10]);
  });

  it("falls back rather than dropping a page the tree does not account for", () => {
    // A third measurable stream that no /Kids entry points at: ordering by the
    // tree would silently return two pages for a three-page file.
    const orphan = deflateSync(Buffer.from("1 0 0 -1 0 800 cm\n0 0 7 7 re\nf", "latin1"));
    const doc = Buffer.concat([
      reversedDoc().subarray(0, reversedDoc().length - "%%EOF\n".length),
      Buffer.from("99 0 obj\n<< >>\nstream\n", "latin1"),
      orphan,
      Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
    ]);
    const pages = measurePdfPages(doc);
    expect(pages).toHaveLength(3);
  });
});

describe("largestRect and mapBoxOf", () => {
  it("largestRect picks by area, not by width or by order", () => {
    const page = measureOne("0 0 300 10 re\nf\n20 20 100 100 re\nf");
    expect(largestRect(page)).toEqual({ x: 20, y: 20, width: 100, height: 100 });
  });

  it("mapBoxOf insets the panel border, because the map is painted inside it", () => {
    const page = measureOne("20 20 100 100 re\nf");
    expect(mapBoxOf(page)).toEqual({ x: 21, y: 21, width: 98, height: 98 });
    expect(mapBoxOf(page, 1.5)).toEqual({ x: 21.5, y: 21.5, width: 97, height: 97 });
  });

  it("both return undefined for a page with nothing drawn on it", () => {
    const page = measureOne("BT\n<41> Tj\nET");
    expect(largestRect(page)).toBeUndefined();
    expect(mapBoxOf(page)).toBeUndefined();
  });
});
