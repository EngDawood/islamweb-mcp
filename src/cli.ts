#!/usr/bin/env node
import path from "node:path";
import { crawlRange, compileJsonlToJson, CrawlResult } from "./crawler.js";
import { LISAN_AL_ARAB } from "./lisanAlArab.js";
import { DICTIONARIES, DictionaryBook, findDictionary } from "./books.js";

const DATA_DIR = process.env.ISLAMWEB_DATA_DIR ?? path.resolve(process.cwd(), "data");

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function jsonlPathFor(key: string): string {
  return path.join(DATA_DIR, `${key}.jsonl`);
}

function jsonPathFor(key: string): string {
  return path.join(DATA_DIR, `${key}.json`);
}

async function crawlOneBook(
  book: DictionaryBook,
  opts: { concurrency: number; delayMs: number; deadline?: number; outFile?: string }
): Promise<CrawlResult> {
  const outFile = opts.outFile ?? jsonlPathFor(book.key);
  console.log(`\n=== ${book.title} (bookId=${book.bookId}) ids ${book.startId}..${book.endId} -> ${outFile} ===`);

  const result = await crawlRange({
    bookId: book.bookId,
    startId: book.startId,
    endId: book.endId,
    outFile,
    concurrency: opts.concurrency,
    delayMs: opts.delayMs,
    deadline: opts.deadline,
    onProgress: (p) => {
      if (p.done % 50 === 0 || p.done === p.total) {
        process.stdout.write(
          `\r[${book.key}] [${p.done}/${p.total}] id=${p.id} ${p.ok ? "ok" : "FAIL: " + p.error}          `
        );
      }
    },
  });

  console.log(`\n${book.key}:`, JSON.stringify(result, null, 2));

  const jsonFile = opts.outFile
    ? path.join(path.dirname(outFile), path.basename(outFile, ".jsonl") + ".json")
    : jsonPathFor(book.key);
  const count = await compileJsonlToJson(outFile, jsonFile);
  console.log(`Compiled ${count} entries -> ${jsonFile}`);
  return result;
}

async function main() {
  const cmd = process.argv[2];
  const concurrency = Number(arg("concurrency", "6"));
  const delayMs = Number(arg("delay", "100"));

  if (cmd === "crawl-lisan-al-arab" || cmd === "crawl-book") {
    const book =
      cmd === "crawl-lisan-al-arab"
        ? { ...LISAN_AL_ARAB, key: "lisan-al-arab" }
        : findDictionary(arg("key") ?? "");
    if (!book) {
      console.error(`Unknown dictionary key/bookId: ${arg("key")}. Known: ${DICTIONARIES.map((d) => d.key).join(", ")}`);
      process.exit(1);
    }
    const startId = Number(arg("start", String(book.startId)));
    const endId = Number(arg("end", String(book.endId)));
    const outFile = arg("out");

    await crawlOneBook({ ...book, startId, endId }, { concurrency, delayMs, outFile });
    return;
  }

  if (cmd === "crawl-all-dictionaries") {
    const minutes = Number(arg("minutes", "320"));
    const deadline = Date.now() + minutes * 60_000;
    console.log(
      `Crawling all ${DICTIONARIES.length} dictionaries under islamweb subject=73, time budget ${minutes} minutes.`
    );

    const summary: Record<string, CrawlResult> = {};
    for (const book of DICTIONARIES) {
      if (Date.now() >= deadline) {
        console.log(`\nTime budget exhausted before starting ${book.key}; will resume next run.`);
        break;
      }
      summary[book.key] = await crawlOneBook(book, { concurrency, delayMs, deadline });
    }

    console.log("\n=== Summary ===");
    for (const [key, result] of Object.entries(summary)) {
      console.log(
        `${key}: fetched=${result.fetched} skipped=${result.skipped} failed=${result.failed.length} stoppedByDeadline=${result.stoppedByDeadline}`
      );
    }
    return;
  }

  console.error(
    [
      "Usage:",
      "  node dist/cli.js crawl-lisan-al-arab [--start=1] [--end=9305] [--out=data/lisan-al-arab.jsonl] [--concurrency=6] [--delay=100]",
      "  node dist/cli.js crawl-book --key=<" + DICTIONARIES.map((d) => d.key).join("|") + "> [--start=] [--end=] [--out=] [--concurrency=6] [--delay=100]",
      "  node dist/cli.js crawl-all-dictionaries [--minutes=320] [--concurrency=6] [--delay=100]",
    ].join("\n")
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
