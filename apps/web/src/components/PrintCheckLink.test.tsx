// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { PrintCheckLink } from "./PrintCheckLink";

describe("PrintCheckLink", () => {
  afterEach(cleanup);

  it("links to a PDF that is really in the build's public directory", () => {
    render(<PrintCheckLink />);
    const href = screen.getByRole("link", { name: /print the ruler page/i }).getAttribute("href")!;
    expect(href).toMatch(/\/print-check\.pdf$/);

    // Run from apps/web; jsdom gives this module a non-file import.meta.url.
    const file = resolve(process.cwd(), "public/print-check.pdf");
    expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
