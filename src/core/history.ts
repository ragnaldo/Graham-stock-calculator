import type { AnnualPoint, HistorySummary } from "./types";

/** Linha anual bruta da base CVM (valores em R$ mil). Ver scripts/update-data.ts. */
export interface AnnualRaw {
  y: number;
  con: boolean;
  rev?: number;
  ebit?: number;
  ni?: number;
  niTotal?: number;
  eq?: number;
  assets?: number;
  ca?: number;
  cl?: number;
  ncl?: number;
  debtS?: number;
  debtL?: number;
  cash?: number;
  div?: number;
  sh?: number;
  shTreas?: number;
}

export type Split = [date: string, factor: number];

const n = (v: number | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const div = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? a / b : null);

/** Produto dos fatores de desdobramento com data posterior a `date` (YYYY-MM-DD). */
export function splitFactorAfter(splits: Split[], date: string): number {
  let f = 1;
  for (const [d, factor] of splits) if (d > date) f *= factor;
  return f;
}

/**
 * Divisor "ações equivalentes de hoje" para o exercício: ações em circulação no ano,
 * trazidas à base atual pelos desdobramentos posteriores e divididas pela composição da unit.
 */
export function adjustedShares(row: AnnualRaw, splits: Split[], unitShares: number): number | null {
  if (!row.sh || row.sh <= 0) return null;
  const outstanding = row.sh - (row.shTreas ?? 0);
  if (outstanding <= 0) return null;
  return (outstanding * splitFactorAfter(splits, `${row.y}-12-31`)) / unitShares;
}

export function summarize(rows: AnnualRaw[], splits: Split[], unitShares: number, maxYears = 12): HistorySummary | null {
  if (!rows.length) return null;
  const last = rows.slice(-maxYears);
  const latest = last[last.length - 1];
  return {
    years: last.map((r) => r.y),
    netIncome: last.map((r) => n(r.ni)),
    dividends: last.map((r) => n(r.div)),
    shares: last.map((r) => adjustedShares(r, splits, unitShares)),
    balance: { year: latest.y, ca: latest.ca, cl: latest.cl, ncl: latest.ncl, debtL: latest.debtL, rev: latest.rev },
  };
}

/** Série mensal ajustada por desdobramentos. `monthly`: "YYYY-MM" -> fechamento bruto. */
export function adjustPrices(monthly: Record<string, number>, splits: Split[]): { month: string; close: number }[] {
  return Object.keys(monthly)
    .sort()
    .map((month) => ({ month, close: monthly[month] / splitFactorAfter(splits, `${month}-31`) }));
}

export interface AnnualInput {
  rows: AnnualRaw[];
  splits: Split[];
  unitShares: number;
  /** "YYYY-MM" -> fechamento bruto (não ajustado). */
  monthly: Record<string, number>;
  /** Proventos por ação por ano (já ajustados), quando disponíveis. */
  dpsByYear?: Map<number, number>;
}

export function buildAnnual({ rows, splits, unitShares, monthly, dpsByYear }: AnnualInput): AnnualPoint[] {
  return rows.map((r) => {
    const shares = adjustedShares(r, splits, unitShares);
    const perShare = (v: number | null) => (v !== null && shares ? (v * 1000) / shares : null);
    const ni = n(r.ni);
    const eq = n(r.eq);
    const rev = n(r.rev);
    const paid = n(r.div);
    const lpa = perShare(ni);
    const vpa = perShare(eq);
    const dps = dpsByYear?.get(r.y) ?? perShare(paid);

    // último fechamento disponível do ano, ajustado
    let price: number | null = null;
    for (let m = 12; m >= 1 && price === null; m--) {
      const key = `${r.y}-${String(m).padStart(2, "0")}`;
      if (monthly[key]) price = monthly[key] / splitFactorAfter(splits, `${key}-31`);
    }
    const debt = r.debtS !== undefined || r.debtL !== undefined ? (r.debtS ?? 0) + (r.debtL ?? 0) : null;
    return {
      year: r.y,
      consolidated: r.con,
      revenue: rev,
      ebit: n(r.ebit),
      netIncome: ni,
      equity: eq,
      assets: n(r.assets),
      currentAssets: n(r.ca),
      currentLiabilities: n(r.cl),
      nonCurrentLiabilities: n(r.ncl),
      grossDebt: debt,
      cash: n(r.cash),
      dividendsPaid: paid,
      lpa,
      vpa,
      dps,
      price,
      pl: lpa !== null && lpa > 0 ? div(price, lpa) : null,
      pvp: vpa !== null && vpa > 0 ? div(price, vpa) : null,
      dy: dps !== null ? div(dps, price) : null,
      roe: eq !== null && eq > 0 ? div(ni, eq) : null,
      netMargin: rev !== null && rev > 0 ? div(ni, rev) : null,
      ebitMargin: rev !== null && rev > 0 ? div(n(r.ebit), rev) : null,
      payout: ni !== null && ni > 0 ? div(paid, ni) : null,
      currentRatio: div(n(r.ca), n(r.cl)),
      debtToEquity: eq !== null && eq > 0 ? div(debt, eq) : null,
    };
  });
}
