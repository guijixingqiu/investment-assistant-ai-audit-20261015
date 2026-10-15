import { createHash } from "node:crypto";
import { parse } from "parse5";
import { RESEARCH_SOURCE_SNAPSHOT_EXTRACTION_VERSION } from "../../../../packages/contracts/src/researchSourceSnapshot.js";
import { ResearchDocumentError } from "./domain.js";

type HtmlNode = { nodeName: string; value?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: HtmlNode[] };
const blockTags = new Set(["article", "div", "p", "h1", "h2", "h3", "h4", "li", "br", "section", "time"]);
const discardedTags = new Set(["script", "style", "noscript", "iframe", "svg", "template", "nav", "footer", "header"]);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Extract only the fixed official article container; never execute HTML. */
export function extractGeelyOfficialHtml(bytes: Buffer) {
  const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const root = parse(html) as unknown as HtmlNode;
  const articles: HtmlNode[] = [];
  const find = (node: HtmlNode) => {
    if (node.attrs?.some(a => a.name === "class" && a.value.split(/\s+/).includes("c-news-detail-content"))) articles.push(node);
    for (const child of node.childNodes ?? []) find(child);
  };
  find(root);
  if (articles.length !== 1) throw new ResearchDocumentError(422, "HTML_ARTICLE_UNAVAILABLE", "official article body must be uniquely identifiable");
  const parts: string[] = [];
  const walk = (node: HtmlNode) => {
    if (discardedTags.has(node.nodeName)) return;
    if (node.nodeName === "#text") { parts.push(node.value ?? ""); return; }
    if (blockTags.has(node.nodeName)) parts.push("\n");
    for (const child of node.childNodes ?? []) walk(child);
    if (blockTags.has(node.nodeName)) parts.push("\n");
  };
  walk(articles[0]!);
  const normalizedText = parts.join("").normalize("NFC").replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ").replace(/ *\n+ */g, "\n").trim();
  if (normalizedText.length < 100 || normalizedText.length > 500000
    || !/Geely Automobile Holdings Ltd\s*\(HK\.0175\)/.test(normalizedText)) {
    throw new ResearchDocumentError(422, "HTML_ISSUER_UNCONFIRMED", "stored article text does not establish the listed issuer");
  }
  const date = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(20\d{2})\b/.exec(normalizedText);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const publishedAt = date ? `${date[3]}-${String(months.indexOf(date[1]!) + 1).padStart(2, "0")}-${date[2]!.padStart(2, "0")}T00:00:00.000Z` : null;
  return { normalizedText, textSha256: sha(normalizedText), extractionVersion: RESEARCH_SOURCE_SNAPSHOT_EXTRACTION_VERSION,
    publishedAt, summary: normalizedText.slice(0, 300) };
}
