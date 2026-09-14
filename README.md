# islamweb-mcp

An MCP (Model Context Protocol) server, written in TypeScript, for fetching and
extracting content from [islamweb.net](https://www.islamweb.net)'s digital
library. It ships with a ready-made, resumable crawler for all five Arabic
dictionaries under islamweb's library subject 73 ("معاجم اللغة") —
see `src/books.ts`:

| key | title | bookId | ids |
|---|---|---|---|
| `lisan-al-arab` | لسان العرب (ابن منظور) | 122 | 1..9305 |
| `al-qamus-al-muhit` | القاموس المحيط (الفيروزآبادي) | 123 | 1..8553 |
| `al-nihaya-fi-gharib-al-hadith` | النهاية في غريب الحديث والأثر (ابن الأثير) | 121 | 1..4338 |
| `maqayis-al-lugha` | معجم مقاييس اللغة (ابن فارس) | 124 | 1..5102 |
| `mukhtar-al-sihah` | مختار الصحاح (الرازي) | 125 | 1..3509 |

Each is extracted to JSON so it can feed a downstream tool for looking up word
definitions. A [scheduled GitHub Action](.github/workflows/crawl-dictionaries.yml)
runs the crawl every 6 hours, resuming and committing new data automatically —
see "Keeping the data fresh" below.

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
| `islamweb_list_dictionaries` | Lists all 5 known dictionaries (bookId, key, title, author, id range). |
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

## Running an extraction

You don't have to drive this through an MCP client — there's a standalone CLI
that does the same thing directly. To crawl one dictionary:

```bash
npm install
npm run build
node dist/cli.js crawl-book --key=al-qamus-al-muhit --concurrency=6 --delay=100
```

(`key` is any key from the table above, or a raw bookId.) To crawl all five,
time-boxed so it fits in e.g. a CI job:

```bash
node dist/cli.js crawl-all-dictionaries --minutes=320 --concurrency=6 --delay=100
```

This prints progress, retries transient failures with exponential backoff
(skipping immediately on a `404`), and writes `data/<key>.jsonl` +
`data/<key>.json` (sorted by id) for each book. Re-running the same command
resumes where it left off — it skips ids already present in that book's
`.jsonl` file, and `crawl-all-dictionaries` skips whole books that are already
fully fetched. `--minutes` stops dispatching new fetches once the budget is
spent (in-flight ones still finish) so a later run can pick up the rest.

## Keeping the data fresh: the scheduled GitHub Action

[`.github/workflows/crawl-dictionaries.yml`](.github/workflows/crawl-dictionaries.yml)
runs `crawl-all-dictionaries` every 6 hours (also triggerable by hand via
"Run workflow"), then commits and pushes any new/changed files under `data/`
back to this branch. Because the crawl is resumable and file-based:

- The first several runs make real progress (fetching whatever's still
  missing across all 5 dictionaries — roughly 31,000 pages total).
- Once everything has been fetched, later runs finish in well under a minute
  (they just confirm every id is already present) and push nothing.
- If islamweb adds pages to a book (a larger `idto` on the bookslist page),
  bump that book's `endId` in `src/books.ts` and the next scheduled run picks
  up the new ids automatically.

The job is time-boxed (`--minutes=320` inside a 350-minute job timeout) so it
always has room to compile and commit before GitHub's own runner limits kick
in, and `concurrency: group: crawl-dictionaries` makes sure two runs never
crawl the same files at once.

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
