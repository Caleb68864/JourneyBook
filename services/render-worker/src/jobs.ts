import { randomUUID } from "node:crypto";
import type { DeliveredDpi, RenderProgress } from "@journeybook/render-cli";

export type { DeliveredDpi };

/**
 * In-memory job registry for the render worker.
 *
 * ADR 0007. Until this existed the worker was a stateless request/response
 * renderer: `POST /render` held the connection open for the whole render, so the
 * only thing anyone could know about a render in flight was that an HTTP call was
 * outstanding. Progress is a property of the process doing the work — only the
 * worker knows it is on page 12 of 60 — and cancel is only real if it reaches
 * that process, so both need the worker to own a job's identity.
 *
 * In memory, deliberately and with the same reasoning ADR 0006 applied to the
 * API's queue: a job is not restartable, so persisting its state would only let a
 * restarted worker report progress for a render that is definitely not happening.
 * A job that dies with the process is reported by its absence — the API's poll
 * gets 404 and says so — which is true, where a persisted "rendering" row would
 * not be.
 */

/** Terminal states are `completed`, `failed` and `cancelled`. */
export type JobState = "rendering" | "completed" | "failed" | "cancelled";

/**
 * Why a job failed, decided by the process that watched it fail rather than by
 * string-matching its message downstream.
 *
 * The worker used to classify an error into an HTTP status by matching
 * substrings of the message ("fetch", "tile", "Invalid "), and the API then read
 * the status back out. That is how a worker timeout got reported as a
 * cancellation. The kind is recorded at the throw site's own catch, where the
 * exception type is still available, and travels as a field.
 */
export type JobErrorKind = "input" | "upstream" | "internal" | "cancelled";

export interface JobRecord {
  id: string;
  state: JobState;
  /** Pages whose basemap panel has finished. */
  page: number;
  /** Total pages in the contract; 0 until the engine has derived them. */
  pageCount: number;
  phase: RenderProgress["phase"];
  /** Volume-relative output path, once the render has completed. */
  outputPath?: string;
  attribution?: string;
  /**
   * The print resolution the finished render actually delivered, straight from
   * `RenderAtlasResult`. Absent while the job is in flight, and absent on a render
   * that drew no basemap.
   *
   * On the record for the same reason `attribution` is: the engine writes it to
   * `stderr` too, and the worker's stderr is a container log. The API is the thing
   * that has to be able to answer "what did this PDF come out at" for a file
   * already on disk, and this is its only channel.
   */
  deliveredDpi?: DeliveredDpi;
  error?: string;
  errorKind?: JobErrorKind;
  startedAt: number;
  finishedAt?: number;
}

/** A job's record plus the handle the route needs to drive it. */
interface JobEntry {
  record: JobRecord;
  controller: AbortController;
}

export interface JobStoreOptions {
  /**
   * How long a finished job stays readable, in ms. Default 15 minutes — longer
   * than the API's own render deadline, so the answer is still there when the
   * last poll arrives. A job evicted before its owner reads it is a render whose
   * outcome is lost, which is worse than a little memory.
   */
  retentionMs?: number;
  /**
   * Most jobs kept at once, terminal ones included. A bound, not a policy: the
   * registry must not be a way to grow this process's memory without limit.
   */
  maxRecords?: number;
  /** Seam for tests. */
  now?: () => number;
}

export class JobStore {
  private readonly jobs = new Map<string, JobEntry>();
  private readonly retentionMs: number;
  private readonly maxRecords: number;
  private readonly now: () => number;

  constructor(options: JobStoreOptions = {}) {
    this.retentionMs = options.retentionMs ?? 15 * 60 * 1000;
    this.maxRecords = options.maxRecords ?? 500;
    this.now = options.now ?? (() => Date.now());
  }

  /** Jobs currently rendering. The route's admission control reads this. */
  activeCount(): number {
    this.sweep();
    let n = 0;
    for (const entry of this.jobs.values()) if (entry.record.state === "rendering") n += 1;
    return n;
  }

  create(): { id: string; signal: AbortSignal } {
    this.sweep();
    const id = randomUUID();
    const controller = new AbortController();
    this.jobs.set(id, {
      controller,
      record: {
        id,
        state: "rendering",
        page: 0,
        pageCount: 0,
        phase: "contract",
        startedAt: this.now(),
      },
    });
    return { id, signal: controller.signal };
  }

  get(id: string): JobRecord | undefined {
    this.sweep();
    return this.jobs.get(id)?.record;
  }

  /** Record a progress event from the engine. Ignored once the job is terminal. */
  progress(id: string, p: RenderProgress): void {
    const entry = this.jobs.get(id);
    if (!entry || entry.record.state !== "rendering") return;
    entry.record.page = p.page;
    entry.record.pageCount = p.pageCount;
    entry.record.phase = p.phase;
  }

  /**
   * Record a finished render.
   *
   * `attribution` and `deliveredDpi` are REQUIRED parameters that accept
   * `undefined` rather than optional ones. Both are facts the engine measured and
   * that have no other route out of this process, and both have been lost before
   * by being left off a call — an optional parameter makes forgetting one a silent
   * success, where this makes it a compile error at every call site.
   */
  complete(
    id: string,
    outputPath: string,
    pageCount: number,
    attribution: string | undefined,
    deliveredDpi: DeliveredDpi | undefined,
  ): void {
    const entry = this.jobs.get(id);
    if (!entry) return;
    entry.record.state = "completed";
    entry.record.phase = "done";
    entry.record.outputPath = outputPath;
    entry.record.pageCount = pageCount;
    entry.record.page = pageCount;
    if (attribution !== undefined) entry.record.attribution = attribution;
    if (deliveredDpi !== undefined) entry.record.deliveredDpi = deliveredDpi;
    entry.record.finishedAt = this.now();
  }

  fail(id: string, kind: JobErrorKind, error: string): void {
    const entry = this.jobs.get(id);
    if (!entry) return;
    // `cancelled` is its own state, not a flavour of failure: it left nothing on
    // disk AND it is what the user asked for, and reporting the second as the
    // first is the whole reason this protocol exists.
    entry.record.state = kind === "cancelled" ? "cancelled" : "failed";
    entry.record.errorKind = kind;
    entry.record.error = error;
    entry.record.finishedAt = this.now();
  }

  /**
   * Ask a job to stop. Returns the record, or undefined when the id is unknown.
   *
   * Aborting a job that has already finished is a no-op that still answers with
   * the record, so a client that cancels just as a render completes is told what
   * actually happened rather than getting a 404 it has to guess about.
   */
  cancel(id: string): JobRecord | undefined {
    const entry = this.jobs.get(id);
    if (!entry) return undefined;
    if (entry.record.state === "rendering") entry.controller.abort();
    return entry.record;
  }

  /** Abort everything still running. For shutdown. */
  abortAll(): void {
    for (const entry of this.jobs.values()) {
      if (entry.record.state === "rendering") entry.controller.abort();
    }
  }

  private sweep(): void {
    const cutoff = this.now() - this.retentionMs;
    for (const [id, entry] of this.jobs) {
      if (entry.record.finishedAt !== undefined && entry.record.finishedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
    if (this.jobs.size <= this.maxRecords) return;
    // Over the cap: drop the oldest FINISHED jobs first. A running job is never
    // evicted — losing the handle to a render that is still consuming tiles would
    // make it uncancellable and unobservable, which is the state this replaced.
    const finished = [...this.jobs.entries()]
      .filter(([, e]) => e.record.finishedAt !== undefined)
      .sort((a, b) => (a[1].record.finishedAt ?? 0) - (b[1].record.finishedAt ?? 0));
    for (const [id] of finished) {
      if (this.jobs.size <= this.maxRecords) break;
      this.jobs.delete(id);
    }
  }
}
