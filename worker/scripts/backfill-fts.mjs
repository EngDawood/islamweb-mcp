#!/usr/bin/env node
// One-time backfill: populates entries_fts for rows inserted into `entries`
// before the sync triggers in schema.sql existed (going forward, the
// triggers keep entries_fts in sync automatically on every write).
//
// Runs in small batches via the D1 REST API (bound params) so it's
// resumable — if D1's daily rows-written quota is hit mid-run, whatever
// completed stays committed and re-running this script picks up where it
// left off (it only ever selects rows still missing from entries_fts).
//
// Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/backfill-fts.mjs
const DATABASE_ID = "c2192e0a-6472-4077-83d0-8d029f3a5c44";
const BATCH_SIZE = 30; // 3 params/row * 30 = 90 bound params, under D1's 100-param cap

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
  return body.result[0].results;
}

async function main() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiToken || !accountId) {
    console.error("Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/backfill-fts.mjs");
    process.exit(1);
  }

  let totalIndexed = 0;
  for (;;) {
    const missing = await runQuery(
      `SELECT rowid, lemma, text FROM entries
       WHERE rowid NOT IN (SELECT rowid FROM entries_fts)
       LIMIT ${BATCH_SIZE}`,
      [],
      apiToken,
      accountId,
    );
    if (missing.length === 0) break;

    const placeholders = missing.map(() => "(?,?,?)").join(", ");
    const params = missing.flatMap((r) => [r.rowid, r.lemma, r.text]);
    await runQuery(`INSERT INTO entries_fts(rowid, lemma, text) VALUES ${placeholders}`, params, apiToken, accountId);

    totalIndexed += missing.length;
    if (totalIndexed % 300 === 0) {
      console.log(`fts backfill: ${totalIndexed} rows indexed so far`);
    }
  }
  console.log(`fts backfill: done, ${totalIndexed} rows indexed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
