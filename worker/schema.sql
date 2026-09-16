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

-- Keep entries_fts in sync incrementally instead of periodic full rebuilds
-- (a full 'rebuild' re-touches every row and is expensive on D1's daily
-- rows-written quota). `INSERT OR REPLACE` — what the importers use — is a
-- delete of the conflicting row followed by an insert of the new one, so
-- both the delete and insert triggers fire per replaced row.
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, lemma, text) VALUES (new.rowid, new.lemma, new.text);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, lemma, text) VALUES ('delete', old.rowid, old.lemma, old.text);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, lemma, text) VALUES ('delete', old.rowid, old.lemma, old.text);
  INSERT INTO entries_fts(rowid, lemma, text) VALUES (new.rowid, new.lemma, new.text);
END;
