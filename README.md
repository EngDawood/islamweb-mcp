# islamweb-mcp

An MCP (Model Context Protocol) server, written in TypeScript, for fetching and
extracting content from [islamweb.net](https://www.islamweb.net)'s digital
library. It ships with a ready-made, resumable crawler for **لسان العرب**
(*Lisan al-Arab*) by Ibn Manzur — content ids `1..9305` under book id `122` —
which it extracts to JSON so it can feed a downstream tool for looking up word
definitions.

## How the site works (reverse-engineered)

Each dictionary page lives at `https://www.islamweb.net/ar/library/content/{bookId}/{id}`
(the trailing Arabic slug is decorative — the server resolves the page from the
numeric id alone). Every page's HTML contains:

- `<div id="pagebody">` — the entry text without diacritics.
- `<div id="pagebody_thaskeel">` — the **same text fully vocalized** (tashkeel).
- `ol#topPath` — a breadcrumb (`لسان العرب` › chapter, e.g. `حرف الهمزة` › the
  current headword, e.g. `أبأ`).
- `<title>` — contains the part/volume number (`الجزء رقم N`).
- `a.topnextbutton` / `a.topprevbutton` — links to the neighboring ids, absent
  at the very first/last page of the book.

`islamwebClient.ts` fetches and parses one page into a `LibraryEntry`:

```ts
{
  bookId, id, url, title, part,
  chapter, chapterId, lemma, breadcrumb,
  printedPage,       // the "[ ص: NN ]" printed page marker, if present
  text,              // plain text
  textTashkeel,      // fully vocalized text
  author, nextId, prevId, fetchedAt
}
```

Each page is one lexical section, which may cover one root or several related
words — it is *not* pre-split into individual dictionary entries. That
finer-grained segmentation (splitting a page's text into per-word definitions)
is left to whatever tool consumes this JSON, since it needs real Arabic
morphological logic to do well.

## Tools exposed over MCP

| Tool | Purpose |
|---|---|
| `islamweb_fetch_entry` | Fetch + parse a single `{bookId, id}` page. |
| `islamweb_lisan_al_arab_info` | Returns the known bookId/id-range for Lisan al-Arab and this server's default output paths. |
| `islamweb_start_crawl` | Starts a background, resumable crawl over an id range; returns a `jobId` immediately. |
| `islamweb_crawl_status` | Poll a `jobId` (or list all jobs from this server process). |
| `islamweb_crawl_stats` | Inspect a JSONL output file on disk (entry count, highest id) — works even after a server restart. |
| `islamweb_compile_json` | Compile the JSONL file into one sorted, pretty-printed JSON array. |
| `islamweb_search` | Substring-search a JSONL file's lemma/text and return snippets. |

### Why JSONL + a compile step

The crawler appends one JSON object per line to a `.jsonl` file as soon as
each page is fetched, instead of holding everything in memory. That makes a
9305-page crawl **resumable**: if it's interrupted, re-running with the same
`outFile` reads back the ids already present and only fetches what's missing.
`islamweb_compile_json` / `compileJsonlToJson` turns that JSONL file into a
single `.json` array once you want a normal JSON file.

## Running the full Lisan al-Arab extraction

You don't have to drive this through an MCP client — there's a standalone CLI
that does the same thing directly:

```bash
npm install
npm run build
node dist/cli.js crawl-lisan-al-arab \
  --start=1 --end=9305 \
  --out=data/lisan-al-arab.jsonl \
  --concurrency=4 --delay=150
```

This prints progress, retries transient failures with exponential backoff
(skipping immediately on a `404`), and writes `data/lisan-al-arab.json`
(sorted by id) once it finishes. Re-running the same command resumes where it
left off.

## Using it as an MCP server

```bash
npm run build
npm start   # speaks MCP over stdio
```

Point any MCP client (Claude Desktop, Claude Code, etc.) at
`node /path/to/islamweb-mcp/dist/index.js`. Example `claude_desktop_config.json`
entry:

```json
{
  "mcpServers": {
    "islamweb": {
      "command": "node",
      "args": ["/absolute/path/to/islamweb-mcp/dist/index.js"]
    }
  }
}
```

Set `ISLAMWEB_DATA_DIR` to change where the default Lisan al-Arab
`.jsonl`/`.json` files live (defaults to `./data`).

## Notes on politeness

`robots.txt` on islamweb.net only disallows `/newislamweb/`, and
`/ar/library/content/...` is not restricted. The crawler still defaults to a
modest concurrency (3) and a per-request delay (250ms) to avoid hammering the
site; both are configurable.
