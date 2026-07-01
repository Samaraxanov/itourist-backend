-- Full-text search for the tour catalog.
--
-- `searchText` (a plain column maintained by the tour service) holds the tour's
-- multilingual title/summary/description concatenated together. Here we add a
-- STORED generated tsvector derived from it, plus a GIN index, so free-text
-- queries use a real inverted index instead of case-sensitive JSON `LIKE`.
--
-- We use the 'simple' text-search config: it does no language-specific stemming,
-- which is the safe choice for mixed uz/ru/en content in one column.

ALTER TABLE "Tour"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("searchText", ''))) STORED;

CREATE INDEX "Tour_searchVector_idx" ON "Tour" USING GIN ("searchVector");
