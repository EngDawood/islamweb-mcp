#!/usr/bin/env node
import path from "node:path";
import { crawlRange, compileJsonlToJson } from "./crawler.js";
import { LISAN_AL_ARAB } from "./lisanAlArab.js";

const DATA_DIR = process.env.ISLAMWEB_DATA_DIR ?? path.resolve(process.cwd(), "data");

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "crawl-lisan-al-arab") {
    const outFile = arg("out", path.join(DATA_DIR, "lisan-al-arab.jsonl"))!;
    const startId = Number(arg("start", String(LISAN_AL_ARAB.startId)));
    const endId = Number(arg("end", String(LISAN_AL_ARAB.endId)));
    const concurrency = Number(arg("concurrency", "3"));
    const delayMs = Number(arg("delay", "250"));

    console.log(
      `Crawling ${LISAN_AL_ARAB.title} (bookId=${LISAN_AL_ARAB.bookId}) ids ${startId}..${endId} -> ${outFile}`
    );

    const result = await crawlRange({
      bookId: LISAN_AL_ARAB.bookId,
      startId,
      endId,
      outFile,
      concurrency,
      delayMs,
      onProgress: (p) => {
        if (p.done % 25 === 0 || p.done === p.total) {
          process.stdout.write(
            `\r[${p.done}/${p.total}] id=${p.id} ${p.ok ? "ok" : "FAIL: " + p.error}          `
          );
        }
      },
    });

    console.log("\nDone.", JSON.stringify(result, null, 2));

    const jsonFile = path.join(path.dirname(outFile), path.basename(outFile, ".jsonl") + ".json");
    const count = await compileJsonlToJson(outFile, jsonFile);
    console.log(`Compiled ${count} entries -> ${jsonFile}`);
    return;
  }

  console.error(
    "Usage: node dist/cli.js crawl-lisan-al-arab [--start=1] [--end=9305] [--out=data/lisan-al-arab.jsonl] [--concurrency=3] [--delay=250]"
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
