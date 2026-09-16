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

## `wrangler.jsonc` location (intentional, non-default)

It lives at the **repo root**, not in `worker/` — `main` inside it is
`worker/src/index.ts`, and `wrangler` (local CLI) auto-discovers it by
walking up from `worker/` when you run `npm run dev`/`deploy` there. This
was a deliberate move at the user's request.

**Tradeoff to know about:** this only works for the local `wrangler` CLI. If
this project is ever connected to Cloudflare's Dashboard Git integration
(Workers Builds / auto-deploy on push), that flow looks for `wrangler.jsonc`
*inside* whatever "Root directory" you configure there — it does not walk up
parent directories. So Root directory = `worker` would not find the config
in that scenario; `wrangler.jsonc` would need to move back into `worker/`
first. Ask before doing that move unprompted — the user chose the split
layout deliberately for the CLI-deploy workflow.

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
