# islamweb-dictionaries-mcp (Cloudflare Worker)

A remote MCP server hosting the 5 dictionaries crawled into `../data/` (see the
repo root README), served over Streamable HTTP from a Cloudflare Worker
backed by D1. Built with `agents`' `McpAgent` — no OAuth: this is read-only,
public-domain classical Arabic text, so it uses the authless pattern.

Tools: `list_dictionaries`, `search_entry` (D1 FTS5, diacritic-insensitive),
`get_entry` (full record by `dictionary` + `id`).

This has been tested end-to-end locally (`wrangler dev --local` + a real
import of one dictionary) — see below to deploy it to your own account.
I don't have your Cloudflare credentials, so the `wrangler login` / `d1
create` / `deploy` steps are yours to run.

**If deploying via Cloudflare Dashboard's Git integration** (Workers Builds —
auto-deploy on push), set **Root directory = `worker`** in that Worker's
Settings → Build. That flow runs `npm install` and `wrangler deploy` from
whatever Root directory you configure, so it needs to land inside `worker/`
(where `package.json` and `wrangler.jsonc` both live) — a repo-root Root
directory fails with `Could not resolve "agents/mcp"` because `agents` is
only a dependency of `worker/package.json`, never installed at the repo root.

## 1. Install

```bash
cd worker
npm install
```

## 2. Create the D1 database

```bash
npx wrangler login          # opens a browser to authorize this machine
npm run db:create           # prints a database_id
```

Paste the printed `database_id` into `wrangler.jsonc`'s `d1_databases[0].database_id`.

## 3. Create the schema

```bash
npm run db:schema:remote
```

## 4. Import the crawled data

Generates `sql-import/<dictionary>.sql` from `../data/<dictionary>.json`
(gitignored — regenerate whenever you re-crawl):

```bash
npm run export:sql
```

Then, for each of the 5 files (this pushes ~150MB of SQL total — expect it to
take a few minutes per dictionary):

```bash
npx wrangler d1 execute islamweb-dictionaries --remote --file=./sql-import/lisan-al-arab.sql
npx wrangler d1 execute islamweb-dictionaries --remote --file=./sql-import/al-qamus-al-muhit.sql
npx wrangler d1 execute islamweb-dictionaries --remote --file=./sql-import/al-nihaya-fi-gharib-al-hadith.sql
npx wrangler d1 execute islamweb-dictionaries --remote --file=./sql-import/maqayis-al-lugha.sql
npx wrangler d1 execute islamweb-dictionaries --remote --file=./sql-import/mukhtar-al-sihah.sql
```

Then rebuild the full-text index once, over everything you just loaded:

```bash
npx wrangler d1 execute islamweb-dictionaries --remote --command "INSERT INTO entries_fts(entries_fts) VALUES('rebuild');"
```

## 5. Deploy

```bash
npm run deploy
```

Wrangler prints your Worker's URL, e.g.
`https://islamweb-dictionaries-mcp.<your-subdomain>.workers.dev`. The MCP
endpoint is that URL + `/mcp`.

## 6. Connect an MCP client

Any Streamable-HTTP-capable MCP client can connect directly to
`https://.../mcp`. For Claude Desktop / Claude Code, use `mcp-remote` as a
local stdio-to-HTTP bridge:

```json
{
  "mcpServers": {
    "islamweb-dictionaries": {
      "command": "npx",
      "args": ["mcp-remote", "https://islamweb-dictionaries-mcp.<your-subdomain>.workers.dev/mcp"]
    }
  }
}
```

## Keeping D1 in sync automatically

`.github/workflows/crawl-dictionaries.yml` syncs D1 to `data/` right after
every crawl that produced new data (same 6h cadence as the crawl itself —
syncing more often than the source data changes would just re-push
identical rows). It runs `worker/scripts/import-via-api.mjs` for each
dictionary (D1 REST API with bound params, so it isn't subject to the
`SQLITE_TOOBIG` statement-length limit `export-to-sql.mjs` can hit on
dictionaries with very large single entries), then rebuilds the FTS index.

For this to run, add two repo secrets (Settings → Secrets and variables →
Actions): `CLOUDFLARE_API_TOKEN` (a token with D1 edit permission) and
`CLOUDFLARE_ACCOUNT_ID`. Without them, the crawl and commit still happen —
only the D1 sync step is skipped (it'll fail loudly if the secrets are
missing but the workflow reaches that step).

## Local development

```bash
npm run db:schema:local   # apply schema.sql to a local D1 (Miniflare) instance
npm run dev                # wrangler dev --local — binds DB + the Durable Object locally
```

`wrangler dev` prints the local URL (default `http://localhost:8787/mcp`).
You can `wrangler d1 execute islamweb-dictionaries --local --file=...` to
load some or all of the `sql-import/` files into that local instance before
testing, so you're not hitting the remote database while iterating.

## Why D1 instead of R2

The compiled `lisan-al-arab.json` alone is ~92MB — reading and `JSON.parse`-ing
that per request would blow a Worker's memory/CPU budget. D1 holds all ~31,000
rows across the 5 dictionaries comfortably (well under D1's free-tier 500MB
cap even with the FTS5 index), and `search_entry` uses D1's own full-text
index instead of a linear text scan.

## Why the crawler didn't move here

Workers are stateless, request-scoped compute — no persistent local disk, and
CPU time per request is capped (seconds, not hours). The crawl (potentially
tens of thousands of HTTP requests over many minutes) stays in
`.github/workflows/crawl-dictionaries.yml` on the repo's GitHub Actions,
which already writes to `../data/`. This Worker only ever reads what that
crawl already produced.
