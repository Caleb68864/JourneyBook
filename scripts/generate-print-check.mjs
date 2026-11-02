#!/usr/bin/env node
/**
 * generate-print-check.mjs — the web app's copy of the one-page print check.
 *
 * Writes apps/web/public/print-check.pdf from `renderCalibrationPdfToBuffer`, and
 * `--check` fails if the committed file no longer draws what the renderer draws. The
 * browser has no PDF renderer, and a static file works when the API is down, which is
 * when someone may be setting up a printer.
 *
 * `--check` compares what each page draws rather than bytes, because the PDF embeds its
 * creation time. Requires a built pdf-client.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measurePdfPages, renderCalibrationPdfToBuffer } from "../packages/pdf-client/dist/index.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps/web/public/print-check.pdf");

const pdf = await renderCalibrationPdfToBuffer();

if (process.argv.includes("--check")) {
  const drawn = (buffer) => JSON.stringify(measurePdfPages(buffer));
  if (!fs.existsSync(OUT) || drawn(fs.readFileSync(OUT)) !== drawn(pdf)) {
    console.error(
      "apps/web/public/print-check.pdf is stale: the renderer now draws something else.\n" +
        "Run: pnpm generate:print-check, then commit the result with the change that caused it.",
    );
    process.exit(1);
  }
  console.log("apps/web/public/print-check.pdf is current");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, pdf);
  console.log("wrote apps/web/public/print-check.pdf");
}
