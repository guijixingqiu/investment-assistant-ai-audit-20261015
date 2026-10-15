/** An open research report is authored as ordered fact and narrative blocks.
 * Projection only uses content and references explicitly selected in this
 * completion. The caller validates each block and the final legacy report. */
type Basis = { sourceId: string; quote: string };
type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value: RecordValue, expected: string[]): boolean {
  return Object.keys(value).sort().join("|") === expected.sort().join("|");
}

export function reportNarrativeBlocksProvided(value: unknown): boolean {
  if (!record(value) || !record(value.report) || !Array.isArray(value.report.sections)
    || value.report.sections.length === 0) return false;
  return value.report.sections.every(section => record(section) && Object.hasOwn(section, "blocks"));
}

export function projectReportNarrativeBlocks(
  value: unknown,
  validateBlock: (text: string, basis: Basis[], field: string) => void,
  _hasFinancialNumber: (text: string) => boolean
): unknown {
  if (!record(value) || !record(value.report) || !Array.isArray(value.report.sections)) return value;
  const sections = value.report.sections;
  if (!sections.some(section => record(section) && Object.hasOwn(section, "blocks"))) return value;
  if (!keys(value.report, ["sections"])) throw new Error("AI_REPORT_NARRATIVE_REPORT_INVALID");
  if (!Array.isArray(value.facts)) throw new Error("AI_REPORT_NARRATIVE_FACTS_REQUIRED");
  const facts = value.facts;
  let linkedFacts = 0;
  const blockErrors: string[] = [];
  let additionalBlockErrors = 0;
  const projected = sections.map((section, sectionIndex) => {
    const field = `report.sections.${sectionIndex}`;
    if (!record(section) || !keys(section, ["heading", "classification", "support", "missingEvidence", "blocks"])
      || !Array.isArray(section.blocks) || section.blocks.length < 1 || section.blocks.length > 10) {
      throw new Error(`AI_REPORT_NARRATIVE_SECTION_INVALID_${field}`);
    }
    const paragraphs: string[] = [], basis: Basis[] = [];
    let narrativeBlocks = 0;
    for (const [blockIndex, block] of section.blocks.entries()) {
      const blockField = `${field}.blocks.${blockIndex}`;
      if (!record(block)) throw new Error(`AI_REPORT_NARRATIVE_BLOCK_INVALID_${blockField}`);
      let text: unknown, ownBasis: unknown;
      if (keys(block, ["factIndex"])) {
        const index = block.factIndex;
        if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= facts.length) {
          throw new Error(`AI_REPORT_NARRATIVE_FACT_INDEX_INVALID_${blockField}`);
        }
        const fact = facts[index as number];
        if (!record(fact) || !["FACT", "SOURCE_SUPPORTED"].includes(String(fact.classification))) {
          throw new Error(`AI_REPORT_NARRATIVE_FACT_NOT_FACT_${blockField}`);
        }
        text = fact.text;
        ownBasis = fact.basis;
        linkedFacts++;
      } else if (keys(block, ["text", "basis"])) {
        text = block.text;
        ownBasis = block.basis;
        narrativeBlocks++;
      } else {
        throw new Error(`AI_REPORT_NARRATIVE_BLOCK_INVALID_${blockField}`);
      }
      if (typeof text !== "string" || text.trim().length < 5 || !Array.isArray(ownBasis) || ownBasis.length === 0
        || !ownBasis.every(item => record(item) && typeof item.sourceId === "string" && typeof item.quote === "string")) {
        throw new Error(`AI_REPORT_NARRATIVE_BLOCK_INVALID_${blockField}`);
      }
      const selected = ownBasis as Basis[];
      try {
        // Narrative amounts use the same own-basis, amount and period checks as
        // fact blocks. Collect independent failures before asking for repair.
        validateBlock(text, selected, keys(block, ["factIndex"])
          ? `${blockField}.facts[${block.factIndex}]` : blockField);
      } catch (error) {
        if (blockErrors.length < 8) blockErrors.push(error instanceof Error ? error.message : `AI_REPORT_NARRATIVE_BLOCK_VALIDATION_${blockField}`);
        else additionalBlockErrors++;
      }
      paragraphs.push(text);
      basis.push(...selected);
    }
    if (narrativeBlocks === 0) throw new Error(`AI_REPORT_NARRATIVE_ANALYSIS_REQUIRED_${field}`);
    const distinct = basis.filter((item, index) => basis.findIndex(other => other.sourceId === item.sourceId && other.quote === item.quote) === index);
    return { heading: section.heading, classification: section.classification, support: section.support,
      missingEvidence: section.missingEvidence, text: paragraphs.join("\n\n"), basis: distinct };
  });
  if (blockErrors.length) throw new Error([...new Set(blockErrors),
    ...(additionalBlockErrors ? [`AI_REPORT_NARRATIVE_ADDITIONAL_BLOCK_ERRORS_${additionalBlockErrors}`] : [])].join(" | "));
  if (linkedFacts === 0) throw new Error("AI_REPORT_NARRATIVE_FACT_LINK_REQUIRED");
  return { ...value, report: { sections: projected } };
}
