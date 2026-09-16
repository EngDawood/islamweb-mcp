# islamweb-mcp

Two things live in this repo:

1. **Root** (`src/`, `data/`) — a stdio MCP server + resumable crawler that
   extracts islamweb.net's 5 classical Arabic dictionaries (subject 73,
   `src/books.ts`) to JSON. `data/<key>.jsonl` is the source of truth
   (resumable, one entry per line); `data/<key>.json` is the compiled array.
   A scheduled GitHub Action (`.github/workflows/crawl-dictionaries.yml`,
   every 6h) keeps it current — it targets `main` specifically, since GitHub
   only fires `schedule` triggers from the workflow file on the default
   branch.

2. **`worker/`** — a *remote* MCP server: the same 5 dictionaries served over
   Streamable HTTP from a Cloudflare Worker + D1 (see `worker/README.md` for
   the deploy steps). It's read-only — it never re-crawls, only serves what's
   already in `data/`.

## Repo/branch layout

- Default branch: `main`. Working branch: `claude/eager-archimedes-e8ku25`.
  Keep both in sync when either changes — `main` must carry the workflow file
  for the crawl schedule to run, and the working branch is where day-to-day
  commits land.
- Repo was renamed `islamweb` → `islamweb-mcp`; remote `origin` points at
  `github.com/EngDawood/islamweb-mcp`.

## `wrangler.jsonc` location

It lives in **`worker/`**, alongside `package.json`. This was briefly moved
to the repo root (so the local CLI could auto-discover it by walking up from
`worker/`), then moved back after a live Cloudflare Dashboard Git-integrated
build (Workers Builds, Root directory unset/root) failed with
`Could not resolve "agents/mcp"` — that build flow runs `npm install` and
`wrangler deploy` from a single configured "Root directory" and does not
walk up parent directories the way the local CLI does, so `agents` (a
`worker/package.json`-only dependency) never got installed. Keep
`wrangler.jsonc` inside `worker/`, and if using Dashboard Git integration,
set that Worker's Settings → Build → Root directory to `worker`. Don't move
it back to root without checking how deploy is actually happening first.

## Data size / GitHub limits

`data/lisan-al-arab.{json,jsonl}` are ~87-92MB each (under GitHub's 100MB
hard block, above its 50MB warning). Total across all 5 dictionaries'
`.json`+`.jsonl` is a few hundred MB. Known and accepted — not a bug to fix
unprompted (e.g. don't switch to Git LFS or drop the `.jsonl`/`.json`
duplication without asking first).

## Conventions

- Classical dictionary text here (Lisan al-Arab, Ibn al-Athir, etc.) is
  public domain — authors died centuries ago. No copyright concern in
  extracting/redistributing it.
- Crawler/CLI commands: `node dist/cli.js crawl-book --key=<dict>` (one
  dictionary) or `crawl-all-dictionaries --minutes=<budget>` (all 5,
  time-boxed, resumable, used by the GitHub Action).
