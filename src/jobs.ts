import { randomUUID } from "node:crypto";
import { crawlRange, CrawlOptions, CrawlResult } from "./crawler.js";

export interface JobState {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  params: Pick<CrawlOptions, "bookId" | "startId" | "endId" | "outFile" | "concurrency" | "delayMs">;
  done: number;
  total: number;
  lastId?: number;
  lastError?: string;
  failedCount: number;
  result?: CrawlResult;
  error?: string;
}

const jobs = new Map<string, JobState>();

export function startCrawlJob(opts: CrawlOptions): JobState {
  const id = randomUUID();
  const state: JobState = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    params: {
      bookId: opts.bookId,
      startId: opts.startId,
      endId: opts.endId,
      outFile: opts.outFile,
      concurrency: opts.concurrency,
      delayMs: opts.delayMs,
    },
    done: 0,
    total: opts.endId - opts.startId + 1,
    failedCount: 0,
  };
  jobs.set(id, state);

  crawlRange({
    ...opts,
    onProgress: (p) => {
      state.done = p.done;
      state.total = p.total;
      state.lastId = p.id;
      if (!p.ok) {
        state.failedCount++;
        state.lastError = p.error;
      }
    },
  })
    .then((result) => {
      state.status = "done";
      state.finishedAt = new Date().toISOString();
      state.result = result;
    })
    .catch((err) => {
      state.status = "failed";
      state.finishedAt = new Date().toISOString();
      state.error = err instanceof Error ? err.message : String(err);
    });

  return state;
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function listJobs(): JobState[] {
  return [...jobs.values()];
}
