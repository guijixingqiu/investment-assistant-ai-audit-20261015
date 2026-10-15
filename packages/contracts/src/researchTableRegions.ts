/** Conservative known table headings; unknown layouts stay unverified. No fuzzy OCR repair. */
export function researchTableRegions(page:string):string[] {
  const pattern=/\bTable [A-Z0-9]+[:.]?|CONDENSED CONSOLIDATED STATEMENT OF (?:PROFIT OR LOSS|CASH FLOWS|FINANCIAL POSITION)|(?:\d+\. )?SHARE CAPITAL|Bran ?d Current month/gi;
  const starts=[...page.matchAll(pattern)].map(m=>m.index!);
  return starts.map((start,i)=>page.slice(start,starts[i+1]??page.length).trim()).filter(s=>s.length<=16000);
}
export function sameSourceTable(page:string,region:string|undefined,labels:string[]):boolean {
  return !!region&&researchTableRegions(page).includes(region)&&labels.every(label=>!!label&&region.includes(label));
}
