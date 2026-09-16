-- islamweb dictionaries: one row per crawled library page, across all 5 dictionaries.
CREATE TABLE IF NOT EXISTS entries (
  dict TEXT NOT NULL,          -- dictionary key, e.g. 'lisan-al-arab' (see src/books.ts)
  id INTEGER NOT NULL,         -- content id within the book
  bookId INTEGER NOT NULL,
  title TEXT,
  part INTEGER,
  chapter TEXT,
  chapterId INTEGER,
  lemma TEXT,
  breadcrumb TEXT,             -- JSON-encoded array of breadcrumb labels
  printedPage INTEGER,
  text TEXT NOT NULL,          -- plain text
  textTashkeel TEXT,           -- fully vocalized text
  author TEXT,
  nextId INTEGER,
  prevId INTEGER,
  fetchedAt TEXT,
  PRIMARY KEY (dict, id)
);

CREATE INDEX IF NOT EXISTS idx_entries_dict_lemma ON entries(dict, lemma);

-- External-content FTS5 index: stores only the token index, not a second copy
-- of `text`/`lemma` (content='entries' points it back at the real table).
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  lemma,
  text,
  content='entries',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
