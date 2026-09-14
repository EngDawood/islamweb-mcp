import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { LibraryEntry } from "./islamwebClient.js";

export interface SearchMatch {
  id: number;
  lemma: string | null;
  chapter: string | null;
  snippet: string;
}

/** Streams a JSONL dictionary file and returns entries whose lemma or text contains `query`. */
export async function searchJsonl(
  jsonlFile: string,
  query: string,
  limit = 20
): Promise<SearchMatch[]> {
  const results: SearchMatch[] = [];
  if (!existsSync(jsonlFile) || !query.trim()) return results;

  const rl = createInterface({ input: createReadStream(jsonlFile, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: LibraryEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const haystack = `${entry.lemma ?? ""}\n${entry.text}`;
    const idx = haystack.indexOf(query);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 60);
    const end = Math.min(haystack.length, idx + query.length + 60);
    results.push({
      id: entry.id,
      lemma: entry.lemma,
      chapter: entry.chapter,
      snippet: (start > 0 ? "…" : "") + haystack.slice(start, end).replace(/\n/g, " ") + (end < haystack.length ? "…" : ""),
    });
    if (results.length >= limit) break;
  }
  return results;
}
