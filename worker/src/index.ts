import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  DB: D1Database;
}

interface EntryRow {
  dict: string;
  id: number;
  bookId: number;
  title: string | null;
  part: number | null;
  chapter: string | null;
  chapterId: number | null;
  lemma: string | null;
  breadcrumb: string | null;
  printedPage: number | null;
  text: string;
  textTashkeel: string | null;
  author: string | null;
  nextId: number | null;
  prevId: number | null;
  fetchedAt: string | null;
}

const DICTIONARIES = [
  { key: "lisan-al-arab", title: "لسان العرب", author: "ابن منظور" },
  { key: "al-qamus-al-muhit", title: "القاموس المحيط", author: "الفيروزآبادي" },
  { key: "al-nihaya-fi-gharib-al-hadith", title: "النهاية في غريب الحديث والأثر", author: "ابن الأثير" },
  { key: "maqayis-al-lugha", title: "معجم مقاييس اللغة", author: "ابن فارس" },
  { key: "mukhtar-al-sihah", title: "مختار الصحاح", author: "الرازي" },
] as const;

function snippet(text: string, needle: string, radius = 80): string {
  const idx = text.indexOf(needle);
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function toResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export class IslamwebMcp extends McpAgent<Env> {
  server = new McpServer({ name: "islamweb-dictionaries", version: "1.0.0" });

  async init() {
    this.server.registerTool(
      "list_dictionaries",
      {
        title: "List dictionaries",
        description:
          "Lists the 5 classical Arabic dictionaries available (key, title, author) — use `key` as the " +
          "`dictionary` argument to search_entry / get_entry.",
        inputSchema: {},
      },
      async () => toResult(DICTIONARIES)
    );

    this.server.registerTool(
      "search_entry",
      {
        title: "Search dictionary entries",
        description:
          "Full-text searches lemma/text across one or all dictionaries and returns matching entries " +
          "(dict, id, lemma, chapter, a snippet) ranked by relevance. Use get_entry with the returned " +
          "(dictionary, id) to fetch the full text of a match.",
        inputSchema: {
          query: z.string().min(1).describe("Arabic search term (diacritics are ignored)"),
          dictionary: z
            .enum(DICTIONARIES.map((d) => d.key) as [string, ...string[]])
            .optional()
            .describe("restrict to one dictionary; omit to search all 5"),
          limit: z.number().int().min(1).max(50).optional().default(10),
        },
      },
      async ({ query, dictionary, limit }) => {
        const ftsQuery = query.replace(/"/g, '""');
        const where = dictionary ? "AND e.dict = ?2" : "";
        const binds = dictionary ? [`"${ftsQuery}"`, dictionary, limit ?? 10] : [`"${ftsQuery}"`, limit ?? 10];
        const sql = dictionary
          ? `SELECT e.dict, e.id, e.lemma, e.chapter, e.text
             FROM entries_fts f JOIN entries e ON e.rowid = f.rowid
             WHERE f.entries_fts MATCH ?1 AND e.dict = ?2
             ORDER BY rank LIMIT ?3`
          : `SELECT e.dict, e.id, e.lemma, e.chapter, e.text
             FROM entries_fts f JOIN entries e ON e.rowid = f.rowid
             WHERE f.entries_fts MATCH ?1
             ORDER BY rank LIMIT ?2`;

        const { results } = await this.env.DB.prepare(sql)
          .bind(...binds)
          .all<Pick<EntryRow, "dict" | "id" | "lemma" | "chapter" | "text">>();

        return toResult(
          results.map((r) => ({
            dictionary: r.dict,
            id: r.id,
            lemma: r.lemma,
            chapter: r.chapter,
            snippet: snippet(r.text, query),
          }))
        );
      }
    );

    this.server.registerTool(
      "get_entry",
      {
        title: "Get one dictionary entry",
        description:
          "Fetches the full record for one (dictionary, id) pair — plain text, fully-vocalized (tashkeel) " +
          "text, chapter/lemma, and neighboring ids — as returned by search_entry or by browsing nextId/prevId.",
        inputSchema: {
          dictionary: z.enum(DICTIONARIES.map((d) => d.key) as [string, ...string[]]),
          id: z.number().int().positive(),
        },
      },
      async ({ dictionary, id }) => {
        const row = await this.env.DB.prepare(`SELECT * FROM entries WHERE dict = ?1 AND id = ?2`)
          .bind(dictionary, id)
          .first<EntryRow>();

        if (!row) return toResult({ error: `no entry ${dictionary}/${id}` });

        return toResult({
          ...row,
          breadcrumb: row.breadcrumb ? JSON.parse(row.breadcrumb) : [],
        });
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/sse") {
      return IslamwebMcp.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("islamweb-dictionaries MCP server. Connect an MCP client to /mcp.", {
      status: 200,
    });
  },
} satisfies ExportedHandler<Env>;
