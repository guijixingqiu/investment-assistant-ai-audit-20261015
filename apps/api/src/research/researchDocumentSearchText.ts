import { RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION } from "../../../../packages/contracts/src/researchDocument.js";

/**
 * Deliberately small common-finance glossary for Hong Kong filings. It widens
 * whole-query spelling variants and offers explicit short search choices; it
 * never rewrites stored citation text or page hashes.
 */
const FINANCE_GLOSSARY: ReadonlyArray<ReadonlyArray<string>> = [
  ["营业收入", "營業收入", "营收"],
  ["所得税", "所得稅"],
  ["母公司股東應佔溢利", "归属于母公司股东的净利润", "本公司擁有人應佔溢利", "歸屬於母公司股東的淨利潤"],
  ["净利润", "淨利潤", "純利"],
  ["销量", "銷量"],
  ["总资产", "總資產", "资产合计", "資產合計"],
  ["总负债", "總負債", "负债合计", "負債合計"],
  ["经营现金流", "經營現金流", "经营活动现金流量净额", "經營活動現金流量淨額"]
];

/** Upper bound on the term list handed to the substring fallback. */
const SEARCH_TERM_LIMIT = 8;
const SUGGESTED_QUERY_LIMIT = 4;

/** Whitespace-compacted, NFKC-normalized form used only for matching. */
export function normalizeSearchQueryText(value: string): string {
  return value.normalize("NFKC").replaceAll(/\s+/gu, " ").trim();
}

export interface ResearchDocumentSearchQuery {
  terms: string[];
  glossaryVersion: typeof RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION | null;
}

/**
 * Returns the bounded term list for the parameterized substring fallback
 * (PostgreSQL `simple` FTS uses the raw query separately). A glossary variant
 * is produced by swapping the matched finance term inside the full compacted
 * query, so year, direction and phrase characters keep qualifying the hit:
 * `2024净利润下降` yields `2024淨利潤下降` and `2024純利下降`, never a bare
 * `净利润` that would match every profit mention.
 */
export function researchDocumentSearchQuery(query: string): ResearchDocumentSearchQuery {
  const normalized = normalizeSearchQueryText(query);
  const compact = compactForMatching(normalized);
  const terms = new Set<string>([compact]);
  let glossaryApplied = false;
  for (const group of FINANCE_GLOSSARY) {
    if (terms.size >= SEARCH_TERM_LIMIT) break;
    const forms = group.map(compactForMatching).filter((form) => form.length > 0);
    const matched = forms.find((form) => compact.includes(form));
    if (matched === undefined) continue;
    glossaryApplied = true;
    for (const form of forms) {
      if (form === matched) continue;
      terms.add(compact.split(matched).join(form));
      if (terms.size >= SEARCH_TERM_LIMIT) break;
    }
  }
  return {
    terms: [...terms].filter((term) => term.length > 0).slice(0, SEARCH_TERM_LIMIT),
    glossaryVersion: glossaryApplied ? RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION : null
  };
}

/** Short original-text search choices; never silently replace the user's full question. */
export function suggestedFinanceSearchQueries(query: string): string[] {
  const compact = compactForMatching(normalizeSearchQueryText(query));
  const suggestions = new Set<string>();
  for (const group of FINANCE_GLOSSARY) {
    const forms = group.map(compactForMatching);
    const matched = forms.find((form) => form.length > 0 && compact.includes(form));
    if (matched === undefined || compact === matched) continue;
    for (const form of [matched, ...forms]) {
      if (form !== compact) suggestions.add(form);
      if (suggestions.size >= SUGGESTED_QUERY_LIMIT) return [...suggestions];
    }
  }
  return [...suggestions];
}

export function compactForMatching(value: string): string {
  return value.replaceAll(/\s+/gu, "");
}

export interface ResearchOriginalTextMatch {
  startUtf16: number;
  endUtf16: number;
  matchedText: string;
}

/** Match a compacted query while keeping every transformed code unit tied to its original UTF-16 span. */
export function findResearchOriginalTextMatch(text: string, terms: readonly string[]): ResearchOriginalTextMatch | null {
  let searchable = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const { segment: original, index: offset } of new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)) {
    const transformed = original.normalize("NFKC").toLocaleLowerCase();
    for (const character of transformed) {
      if (/\s/u.test(character)) continue;
      searchable += character;
      for (let unit = 0; unit < character.length; unit++) {
        starts.push(offset);
        ends.push(offset + original.length);
      }
    }
  }
  let best: ResearchOriginalTextMatch | null = null;
  for (const rawTerm of terms) {
    const term = rawTerm.normalize("NFKC").toLocaleLowerCase().replaceAll(/\s+/gu, "");
    if (!term) continue;
    const index = searchable.indexOf(term);
    if (index < 0) continue;
    const startUtf16 = starts[index]!;
    const endUtf16 = ends[index + term.length - 1]!;
    if (best && startUtf16 >= best.startUtf16) continue;
    best = { startUtf16, endUtf16, matchedText: text.slice(startUtf16, endUtf16) };
  }
  return best;
}

export { RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION };
