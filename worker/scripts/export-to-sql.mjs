#!/usr/bin/env node
// Reads ../data/<key>.json (produced by the crawler) and writes batched
// INSERT statements to ./sql-import/<key>.sql, ready for:
//   wrangler d1 execute islamweb-dictionaries --remote --file=./sql-import/<key>.sql
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const OUT_DIR = path.resolve(__dirname, "../sql-import");
// D1 rejects overly large single statements (SQLITE_TOOBIG). Some entries
// (e.g. long Lisan al-Arab entries) run tens of KB each, so batch by
// cumulative byte size rather than a fixed row count.
const MAX_STATEMENT_BYTES = 40_000;

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return value === null || value === undefined ? "NULL" : String(value);
}

function rowValues(dictKey, entry) {
  const breadcrumb = JSON.stringify(entry.breadcrumb ?? []);
  return [
    sqlString(dictKey),
    sqlNumber(entry.id),
    sqlNumber(entry.bookId),
    sqlString(entry.title),
    sqlNumber(entry.part),
    sqlString(entry.chapter),
    sqlNumber(entry.chapterId),
    sqlString(entry.lemma),
    sqlString(breadcrumb),
    sqlNumber(entry.printedPage),
    sqlString(entry.text),
    sqlString(entry.textTashkeel),
    sqlString(entry.author),
    sqlNumber(entry.nextId),
    sqlNumber(entry.prevId),
    sqlString(entry.fetchedAt),
  ].join(", ");
}

const COLUMNS =
  "(dict, id, bookId, title, part, chapter, chapterId, lemma, breadcrumb, printedPage, text, textTashkeel, author, nextId, prevId, fetchedAt)";

function exportDictionary(jsonFile, key) {
  const entries = JSON.parse(readFileSync(jsonFile, "utf8"));
  const lines = [];
  let batch = [];
  let batchBytes = 0;

  function flush() {
    if (batch.length === 0) return;
    const values = batch.join(",\n  ");
    lines.push(`INSERT OR REPLACE INTO entries ${COLUMNS} VALUES\n  ${values};`);
    batch = [];
    batchBytes = 0;
  }

  for (const entry of entries) {
    const row = `(${rowValues(key, entry)})`;
    const rowBytes = Buffer.byteLength(row, "utf8");
    if (batch.length > 0 && batchBytes + rowBytes > MAX_STATEMENT_BYTES) {
      flush();
    }
    batch.push(row);
    batchBytes += rowBytes;
  }
  flush();

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${key}.sql`);
  writeFileSync(outFile, lines.join("\n\n") + "\n", "utf8");
  console.log(`${key}: ${entries.length} rows -> ${outFile}`);
}

const jsonFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".jsonl"));
if (jsonFiles.length === 0) {
  console.error(`No .json files found in ${DATA_DIR}. Run the crawler first.`);
  process.exit(1);
}

for (const file of jsonFiles) {
  const key = path.basename(file, ".json");
  exportDictionary(path.join(DATA_DIR, file), key);
}

console.log(
  `\nDone. For each file, run:\n  wrangler d1 execute islamweb-dictionaries --remote --file=./sql-import/<key>.sql`
);
