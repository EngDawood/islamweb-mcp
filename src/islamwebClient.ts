import * as cheerio from "cheerio";

export interface FetchOptions {
  timeoutMs?: number;
  userAgent?: string;
}

export interface LibraryEntry {
  bookId: number;
  id: number;
  url: string;
  title: string | null;
  part: number | null;
  chapter: string | null;
  chapterId: number | null;
  lemma: string | null;
  breadcrumb: string[];
  printedPage: number | null;
  text: string;
  textTashkeel: string;
  author: string | null;
  nextId: number | null;
  prevId: number | null;
  fetchedAt: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class IslamwebHttpError extends Error {
  constructor(public status: number, public url: string) {
    super(`islamweb request failed: ${status} ${url}`);
    this.name = "IslamwebHttpError";
  }
}

export function contentUrl(bookId: number, id: number): string {
  return `https://www.islamweb.net/ar/library/content/${bookId}/${id}`;
}

/** Fetch the raw HTML of a /ar/library/content/{bookId}/{id} page. The slug segment is optional. */
export async function fetchContentHtml(
  bookId: number,
  id: number,
  opts: FetchOptions = {}
): Promise<string> {
  const url = contentUrl(bookId, id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": opts.userAgent ?? DEFAULT_UA,
        "Accept-Language": "ar,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new IslamwebHttpError(res.status, url);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/** Convert a book-content DOM fragment (islamweb's #pagebody) to plain text, preserving paragraph breaks. */
function extractText($: cheerio.CheerioAPI, root: ReturnType<cheerio.CheerioAPI>): string {
  const clone = root.clone();
  clone.find("br").replaceWith("\n");
  clone.find("p, div").each((_, el) => {
    $(el).append("\n");
  });
  const raw = clone.text();
  return raw
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractIdFromHref(href: string | undefined, bookId: number): number | null {
  if (!href) return null;
  const m = href.match(new RegExp(`/library/content/${bookId}/(\\d+)`));
  return m ? Number(m[1]) : null;
}

export function parseContentHtml(html: string, bookId: number, id: number): LibraryEntry {
  const $ = cheerio.load(html);

  const titleRaw = $("title").first().text().trim() || null;
  const partMatch = titleRaw?.match(/الجزء رقم\s*(\d+)/);
  const part = partMatch ? Number(partMatch[1]) : null;

  const breadcrumb: string[] = [];
  $('ol#topPath [itemprop="itemListElement"]').each((_, el) => {
    const name = $(el).find('[itemprop="name"]').first().text().trim();
    if (name) breadcrumb.push(name);
  });

  // breadcrumb[0] is the book title, the last entry is the current lemma/heading,
  // and (when there are 3+ levels) breadcrumb[1] is the enclosing chapter (e.g. "حرف الهمزة").
  const lemma = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 1] : null;
  const chapter = breadcrumb.length > 2 ? breadcrumb[1] : breadcrumb.length === 2 ? breadcrumb[1] : null;

  let chapterId: number | null = null;
  const chapterHref = $('ol#topPath [itemprop="itemListElement"] a[itemprop="item"]')
    .eq(1)
    .attr("href");
  chapterId = extractIdFromHref(chapterHref, bookId);

  const author =
    $('div[itemtype="http://schema.org/Article"] meta[itemprop="author"]').attr("content")?.trim() ??
    null;

  const bodyRoot = $("#pagebody").first();
  const tashkeelRoot = $("#pagebody_thaskeel").first();

  const text = bodyRoot.length ? extractText($, bodyRoot) : "";
  const textTashkeel = tashkeelRoot.length ? extractText($, tashkeelRoot) : "";

  const pageMatch = text.match(/\[\s*ص:\s*(\d+)\s*\]/);
  const printedPage = pageMatch ? Number(pageMatch[1]) : null;

  const nextHref = $("a.topnextbutton").attr("href");
  const prevHref = $("a.topprevbutton").attr("href");

  return {
    bookId,
    id,
    url: contentUrl(bookId, id),
    title: titleRaw,
    part,
    chapter,
    chapterId,
    lemma,
    breadcrumb,
    printedPage,
    text,
    textTashkeel,
    author,
    nextId: extractIdFromHref(nextHref, bookId),
    prevId: extractIdFromHref(prevHref, bookId),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchEntry(
  bookId: number,
  id: number,
  opts: FetchOptions = {}
): Promise<LibraryEntry> {
  const html = await fetchContentHtml(bookId, id, opts);
  return parseContentHtml(html, bookId, id);
}
