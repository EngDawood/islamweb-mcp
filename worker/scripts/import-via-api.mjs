#!/usr/bin/env node
// Imports ../../data/<key>.json into D1 via the Cloudflare REST API using
// parameterized queries (bound params, not inlined SQL text).
//
// export-to-sql.mjs's raw-SQL approach hits SQLITE_TOOBIG for dictionaries
// with very large single entries (e.g. lisan-al-arab has an entry whose
// escaped SQL row alone is ~224KB) because the whole INSERT statement,
// including escaped text, has to fit under D1's statement-length limit.
// Bound params keep the compiled SQL text itself tiny regardless of how
// much text is bound to each placeholder, so it isn't subject to that limit.
//
// Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   node scripts/import-via-api.mjs <dictionary-key>
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const DATABASE_ID = "c2192e0a-6472-4077-83d0-8d029f3a5c44";
const ROWS_PER_QUERY = 6; // 16 columns/row * 6 = 96 bound params, under D1's 100-param cap

const COLUMNS =
  "(dict, id, bookId, title, part, chapter, chapterId, lemma, breadcrumb, printedPage, text, textTashkeel, author, nextId, prevId, fetchedAt)";

function rowParams(dictKey, entry) {
  return [
    dictKey,
    entry.id ?? null,
    entry.bookId ?? null,
    entry.title ?? null,
    entry.part ?? null,
    entry.chapter ?? null,
    entry.chapterId ?? null,
    entry.lemma ?? null,
    JSON.stringify(entry.breadcrumb ?? []),
    entry.printedPage ?? null,
    entry.text ?? null,
    entry.textTashkeel ?? null,
    entry.author ?? null,
    entry.nextId ?? null,
    entry.prevId ?? null,
    entry.fetchedAt ?? null,
  ];
}

async function runQuery(sql, params, apiToken, accountId) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(`D1 query failed (${res.status}): ${JSON.stringify(body.errors ?? body)}`);
  }
  return body;
}

async function main() {
  const key = process.argv[2];
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!key || !apiToken || !accountId) {
    console.error("Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/import-via-api.mjs <dictionary-key>");
    process.exit(1);
  }

  const entries = JSON.parse(readFileSync(path.join(DATA_DIR, `${key}.json`), "utf8"));
  let imported = 0;
  for (let i = 0; i < entries.length; i += ROWS_PER_QUERY) {
    const batch = entries.slice(i, i + ROWS_PER_QUERY);
    const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(", ");
    const params = batch.flatMap((e) => rowParams(key, e));
    const sql = `INSERT OR REPLACE INTO entries ${COLUMNS} VALUES ${placeholders}`;
    await runQuery(sql, params, apiToken, accountId);
    imported += batch.length;
    if (imported % 600 === 0 || imported === entries.length) {
      console.log(`${key}: ${imported}/${entries.length} rows imported`);
    }
  }
  console.log(`${key}: done, ${imported} rows imported via API`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
