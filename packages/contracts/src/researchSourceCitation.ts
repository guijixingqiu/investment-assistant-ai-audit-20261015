/** Legacy PDF citations deliberately have no kind key on the wire. */
export interface ResearchPdfPageCitation {
  kind?: never;
  documentId: string;
  pageNumber: number;
  pageTextSha256: string;
}

/** Offsets are half-open UTF-16 code-unit indexes into stored normalizedText. */
export interface ResearchSnapshotTextCitation {
  kind: "source_snapshot";
  snapshotId: string;
  textSha256: string;
  startUtf16: number;
  endUtf16: number;
  excerptSha256: string;
}

export type ResearchSourceCitation = ResearchPdfPageCitation | ResearchSnapshotTextCitation;
export const isSnapshotTextCitation = (value: ResearchSourceCitation | null | undefined): value is ResearchSnapshotTextCitation =>
  value?.kind === "source_snapshot";
export const isPdfPageCitation = (value: ResearchSourceCitation | null | undefined): value is ResearchPdfPageCitation =>
  !!value && !isSnapshotTextCitation(value);
