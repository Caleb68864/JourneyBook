/// <reference types="vite/client" />

/**
 * Build-time variables this app reads, declared so they are discoverable and
 * typed rather than being stringly-typed lookups scattered through the source.
 */
interface ImportMetaEnv {
  /**
   * Base URL for the generated documentation the scale picker links to, with no
   * trailing slash — e.g. `https://github.com/<owner>/<repo>/blob/<branch>`.
   *
   * Defaults to this repository's `master`. Override it on a fork or a branch
   * that renames the file: the default would otherwise serve a link that looks
   * authoritative and describes a different build, which is worse than no link.
   */
  readonly VITE_DOCS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
