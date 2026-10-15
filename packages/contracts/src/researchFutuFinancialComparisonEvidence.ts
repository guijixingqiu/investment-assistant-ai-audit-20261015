import type {FutuFinancialHistoryValue} from "./researchFutuFinancialStatement.js";

/** Bounded public-source observations. Apply only while the exact observed provider values still match. */
const observations=[
  {id:"geely_older_annual_basis",symbol:"HK.00175",periodEnds:["2021-12-31","2022-12-31","2023-12-31","2024-12-31"],
    text:"已读 2025 年报的重列摘要显示，2021–2023 年收入等年度值与本批 OpenD 旧版值不同；2024 年收入已采用后来的重列数。五年不能无提示称作同一会计口径；早年经营现金流的新版逐项值仍未确立。",
    sourceUrl:"https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0427/2026042700756.pdf",
    matches:[{metric:"revenue",periodEnd:"2021-12-31",rawValue:"101611056000"},
      {metric:"revenue",periodEnd:"2022-12-31",rawValue:"147964647000"},
      {metric:"revenue",periodEnd:"2023-12-31",rawValue:"179203592000"},
      {metric:"revenue",periodEnd:"2024-12-31",rawValue:"275910484000"}]},
  {id:"geely_year_end_balance_version",symbol:"HK.00175",periodEnds:["2025-12-31","2026-06-30"],
    text:"OpenD 2025 年末资产及负债是 2025 年报当期值；已读 2026 中报的 2025 年末比较列再次重列。比较 2026 年六月与 2025 年末时须先固定版本，不直接把两版时点数相减。",
    sourceUrl:"https://www.geelyauto.com.hk/wp-content/uploads/2026/08/e00175_2026-interim-report.pdf",
    matches:[{metric:"total_assets",periodEnd:"2025-12-31",rawValue:"290410094000"},
      {metric:"total_liabilities",periodEnd:"2025-12-31",rawValue:"196794886000"},
      {metric:"total_assets",periodEnd:"2026-06-30",rawValue:"300852825000"}]},
  {id:"geely_prior_half_year_restatement",symbol:"HK.00175",periodEnds:["2025-06-30","2026-06-30"],
    text:"本批 OpenD 2025 上半年收入采用 2026 中报的重列比较数。若计算半年同比，须保留这一来源版本，不能混入旧版 2025 上半年收入。",
    sourceUrl:"https://www.geelyauto.com.hk/wp-content/uploads/2026/08/e00175_2026-interim-report.pdf",
    matches:[{metric:"revenue",periodEnd:"2025-06-30",rawValue:"151390219000"}]}
] as const;

export function observedFutuComparisonNotices(symbol:string,values:FutuFinancialHistoryValue[]){
  return observations.filter(note=>note.symbol===symbol&&note.matches.every(expected=>values.some(value=>
    value.metric===expected.metric&&value.periodEnd===expected.periodEnd&&value.rawValue===expected.rawValue)))
    .map(({id,text,sourceUrl,periodEnds})=>({id,text,sourceUrl,periodEnds:[...periodEnds]}));
}
