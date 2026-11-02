/**
 * The way to find out whether this printer is true to scale before spending paper on an
 * atlas. A static file from `scripts/generate-print-check.mjs`, so it opens even when the
 * API is down.
 */
export function PrintCheckLink() {
  return (
    <p className="font-mono text-[10px] text-bark-500">
      New printer?{" "}
      <a
        href={`${import.meta.env.BASE_URL}print-check.pdf`}
        target="_blank"
        rel="noreferrer"
        className="text-forest-700 underline hover:text-forest-600"
      >
        Print the ruler page
      </a>{" "}
      at 100% and hold a real ruler to it.
    </p>
  );
}
