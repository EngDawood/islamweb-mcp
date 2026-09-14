import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fetchEntry, IslamwebHttpError, LibraryEntry } from "./islamwebClient.js";

export interface CrawlOptions {
  bookId: number;
  startId: number;
  endId: number;
  outFile: string;
  concurrency?: number;
  delayMs?: number;
  maxRetries?: number;
  onProgress?: (info: CrawlProgress) => void;
}

export interface CrawlProgress {
  id: number;
  done: number;
  total: number;
  ok: boolean;
  error?: string;
}

export interface CrawlResult {
  outFile: string;
  fetched: number;
  skipped: number;
  failed: { id: number; error: string }[];
}

/** Reads the JSONL output file (if any) and returns the set of ids already fetched, for resuming. */
async function loadCompletedIds(outFile: string): Promise<Set<number>> {
  const done = new Set<number>();
  if (!existsSync(outFile)) return done;
  const rl = createInterface({ input: createReadStream(outFile, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.id === "number") done.add(obj.id);
    } catch {
      // ignore malformed trailing line (e.g. truncated by a previous crash)
    }
  }
  return done;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Crawls a contiguous range of content ids from a single islamweb library book,
 * appending each parsed entry as one JSON line to `outFile`. Safe to interrupt and
 * re-run: already-fetched ids (read back from outFile) are skipped.
 */
export async function crawlRange(opts: CrawlOptions): Promise<CrawlResult> {
  const {
    bookId,
    startId,
    endId,
    outFile,
    concurrency = 3,
    delayMs = 250,
    maxRetries = 4,
    onProgress,
  } = opts;

  await mkdir(path.dirname(outFile), { recursive: true });
  const completed = await loadCompletedIds(outFile);

  const ids: number[] = [];
  for (let id = startId; id <= endId; id++) {
    if (!completed.has(id)) ids.push(id);
  }

  const total = endId - startId + 1;
  let done = total - ids.length;
  const failed: { id: number; error: string }[] = [];

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      let lastError: unknown;
      let entry: LibraryEntry | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          entry = await fetchEntry(bookId, id);
          break;
        } catch (err) {
          lastError = err;
          const status = err instanceof IslamwebHttpError ? err.status : undefined;
          if (status === 404) break; // no such id, don't retry
          const backoff = Math.min(30_000, 1000 * 2 ** attempt);
          await sleep(backoff);
        }
      }

      if (entry) {
        await appendFile(outFile, JSON.stringify(entry) + "\n", "utf8");
        done++;
        onProgress?.({ id, done, total, ok: true });
      } else {
        done++;
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        failed.push({ id, error: message });
        onProgress?.({ id, done, total, ok: false, error: message });
      }

      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  return {
    outFile,
    fetched: total - completed.size - failed.length,
    skipped: completed.size,
    failed,
  };
}

/** Compiles a JSONL file produced by crawlRange into a single pretty-printed JSON array file. */
export async function compileJsonlToJson(jsonlFile: string, jsonFile: string): Promise<number> {
  const entries: LibraryEntry[] = [];
  if (existsSync(jsonlFile)) {
    const rl = createInterface({ input: createReadStream(jsonlFile, "utf8"), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      entries.push(JSON.parse(line));
    }
  }
  entries.sort((a, b) => a.id - b.id);
  const tmp = jsonFile + ".tmp";
  await writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await rename(tmp, jsonFile);
  return entries.length;
}

export async function readCrawlStats(outFile: string): Promise<{ count: number; lastId: number | null }> {
  if (!existsSync(outFile)) return { count: 0, lastId: null };
  const ids = await loadCompletedIds(outFile);
  const arr = [...ids].sort((a, b) => a - b);
  return { count: arr.length, lastId: arr.length ? arr[arr.length - 1] : null };
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}
