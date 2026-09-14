#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { fetchEntry } from "./islamwebClient.js";
import { compileJsonlToJson, readCrawlStats } from "./crawler.js";
import { startCrawlJob, getJob, listJobs } from "./jobs.js";
import { searchJsonl } from "./search.js";
import { LISAN_AL_ARAB } from "./lisanAlArab.js";
import { DICTIONARIES } from "./books.js";

const DATA_DIR = process.env.ISLAMWEB_DATA_DIR ?? path.resolve(process.cwd(), "data");
const LISAN_JSONL = path.join(DATA_DIR, "lisan-al-arab.jsonl");
const LISAN_JSON = path.join(DATA_DIR, "lisan-al-arab.json");

function textResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

const server = new McpServer({ name: "islamweb-mcp", version: "0.1.0" });

server.registerTool(
  "islamweb_fetch_entry",
  {
    title: "Fetch one islamweb library page",
    description:
      "Fetches a single content page from islamweb.net's library " +
      "(https://www.islamweb.net/ar/library/content/{bookId}/{id}) and returns it parsed as JSON: " +
      "title, chapter/lemma breadcrumb, plain text, fully-vocalized (tashkeel) text, and next/prev ids.",
    inputSchema: {
      bookId: z.number().int().positive().describe("islamweb library book id, e.g. 122 for Lisan al-Arab"),
      id: z.number().int().positive().describe("content id within the book (the number in the page URL)"),
    },
  },
  async ({ bookId, id }) => {
    const entry = await fetchEntry(bookId, id);
    return textResult(entry);
  }
);

server.registerTool(
  "islamweb_lisan_al_arab_info",
  {
    title: "Lisan al-Arab crawl coordinates",
    description:
      "Returns the known bookId and id range (1..9305) for لسان العرب لابن منظور on islamweb.net, " +
      "plus the paths this server uses for its extracted JSON/JSONL dataset.",
    inputSchema: {},
  },
  async () => {
    return textResult({
      ...LISAN_AL_ARAB,
      jsonlFile: LISAN_JSONL,
      jsonFile: LISAN_JSON,
    });
  }
);

server.registerTool(
  "islamweb_list_dictionaries",
  {
    title: "List known islamweb dictionaries",
    description:
      "Returns every dictionary this server knows about under islamweb's library subject 73 " +
      "(معاجم اللغة): bookId, key, title, author, and id range. This is the registry the " +
      "GitHub Actions crawl workflow and the crawl-all-dictionaries CLI command iterate over.",
    inputSchema: {},
  },
  async () => textResult(DICTIONARIES)
);

server.registerTool(
  "islamweb_start_crawl",
  {
    title: "Start a background crawl",
    description:
      "Starts crawling a contiguous range of content ids from one islamweb library book in the background " +
      "(this call returns immediately with a jobId; poll islamweb_crawl_status with it). " +
      "Each fetched page is appended as one JSON line to outFile as soon as it is parsed, so the crawl is " +
      "resumable: re-running with the same outFile skips ids already present in it. " +
      "Defaults are set up for لسان العرب لابن منظور (bookId 122, ids 1..9305) — omit bookId/startId/endId/outFile to crawl the whole dictionary.",
    inputSchema: {
      bookId: z.number().int().positive().optional().describe(`defaults to ${LISAN_AL_ARAB.bookId}`),
      startId: z.number().int().positive().optional().describe(`defaults to ${LISAN_AL_ARAB.startId}`),
      endId: z.number().int().positive().optional().describe(`defaults to ${LISAN_AL_ARAB.endId}`),
      outFile: z.string().optional().describe(`defaults to ${LISAN_JSONL}`),
      concurrency: z.number().int().min(1).max(8).optional().describe("parallel requests, default 3"),
      delayMs: z.number().int().min(0).optional().describe("delay after each request per worker, default 250ms"),
    },
  },
  async ({ bookId, startId, endId, outFile, concurrency, delayMs }) => {
    const job = startCrawlJob({
      bookId: bookId ?? LISAN_AL_ARAB.bookId,
      startId: startId ?? LISAN_AL_ARAB.startId,
      endId: endId ?? LISAN_AL_ARAB.endId,
      outFile: outFile ?? LISAN_JSONL,
      concurrency,
      delayMs,
    });
    return textResult({
      jobId: job.id,
      status: job.status,
      total: job.total,
      outFile: job.params.outFile,
      note: "Call islamweb_crawl_status with this jobId to check progress.",
    });
  }
);

server.registerTool(
  "islamweb_crawl_status",
  {
    title: "Check crawl job status",
    description: "Returns progress (done/total/failed) for a crawl job started with islamweb_start_crawl.",
    inputSchema: {
      jobId: z.string().optional().describe("omit to list all known jobs from this server session"),
    },
  },
  async ({ jobId }) => {
    if (!jobId) return textResult(listJobs());
    const job = getJob(jobId);
    if (!job) return textResult({ error: `no such jobId: ${jobId}` });
    return textResult(job);
  }
);

server.registerTool(
  "islamweb_crawl_stats",
  {
    title: "Inspect an output JSONL file on disk",
    description:
      "Reads a JSONL dataset file directly from disk (independent of any in-memory job) and reports how " +
      "many entries it has and the highest id fetched so far. Useful after restarting the MCP server to see " +
      "how far a previous crawl got.",
    inputSchema: {
      outFile: z.string().optional().describe(`defaults to ${LISAN_JSONL}`),
    },
  },
  async ({ outFile }) => {
    const stats = await readCrawlStats(outFile ?? LISAN_JSONL);
    return textResult(stats);
  }
);

server.registerTool(
  "islamweb_compile_json",
  {
    title: "Compile JSONL crawl output into one JSON array",
    description:
      "Reads a JSONL dataset file (one entry per line) and writes it out as a single sorted, pretty-printed " +
      "JSON array file. Run this once a crawl has finished (or whenever you want a fresh snapshot).",
    inputSchema: {
      jsonlFile: z.string().optional().describe(`defaults to ${LISAN_JSONL}`),
      jsonFile: z.string().optional().describe(`defaults to ${LISAN_JSON}`),
    },
  },
  async ({ jsonlFile, jsonFile }) => {
    const count = await compileJsonlToJson(jsonlFile ?? LISAN_JSONL, jsonFile ?? LISAN_JSON);
    return textResult({ jsonFile: jsonFile ?? LISAN_JSON, entries: count });
  }
);

server.registerTool(
  "islamweb_search",
  {
    title: "Search extracted entries",
    description:
      "Substring-searches a JSONL dataset file's lemma and text fields and returns matching entries " +
      "(id, lemma, chapter, and a snippet around the match). Use this to spot-check a crawl or to look up a word.",
    inputSchema: {
      query: z.string().min(1),
      jsonlFile: z.string().optional().describe(`defaults to ${LISAN_JSONL}`),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async ({ query, jsonlFile, limit }) => {
    const matches = await searchJsonl(jsonlFile ?? LISAN_JSONL, query, limit ?? 20);
    return textResult(matches);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("islamweb-mcp fatal error:", err);
  process.exit(1);
});
