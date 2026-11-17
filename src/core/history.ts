import type { AnnualPoint, HistorySummary, QuarterPoint } from "./types";

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
  return sharesAt(row.sh, row.shTreas, `${row.y}-12-31`, splits, unitShares);
}

function sharesAt(sh: number | undefined, treas: number | undefined, date: string, splits: Split[], unitShares: number): number | null {
  if (!sh || sh <= 0) return null;
  const outstanding = sh - (treas ?? 0);
  if (outstanding <= 0) return null;
  return (outstanding * splitFactorAfter(splits, date)) / unitShares;
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

/** Trimestre bruto da base CVM (ITR; o 4º trimestre vem do anual menos o acumulado até setembro). */
export interface QuarterRaw {
  d: string;
  con: boolean;
  rev?: number;
  ebit?: number;
  ni?: number;
  div?: number;
  eq?: number;
  assets?: number;
  ca?: number;
  cl?: number;
  ncl?: number;
  debtS?: number;
  debtL?: number;
  cash?: number;
  sh?: number;
  shTreas?: number;
}

export const quarterLabel = (d: string) => `${Math.ceil(Number(d.slice(5, 7)) / 3)}T${d.slice(2, 4)}`;

const grossDebt = (r: { debtS?: number; debtL?: number }) => (r.debtS !== undefined || r.debtL !== undefined ? (r.debtS ?? 0) + (r.debtL ?? 0) : null);

/**
 * Ações do trimestre trazidas à base atual. Algumas empresas informam a quantidade nos ITR em
 * milhares ou com erros; quando destoa mais de 1,6× da quantidade atual, vale a atual.
 */
function quarterShares(r: QuarterRaw, splits: Split[], unitShares: number, currentShares: number | null): number | null {
  const own = sharesAt(r.sh, r.shTreas, r.d, splits, unitShares);
  const ref = currentShares && currentShares > 0 ? currentShares / unitShares : null;
  if (own === null) return ref;
  if (ref === null) return own;
  const ratio = own / ref;
  return ratio > 1 / 1.6 && ratio < 1.6 ? own : ref;
}

/** `currentShares`: total de ações da empresa hoje (Fundamentus), para conferir as dos ITR. */
export function buildQuarters(rows: QuarterRaw[], splits: Split[], unitShares: number, currentShares: number | null = null): QuarterPoint[] {
  return rows.map((r) => {
    const shares = quarterShares(r, splits, unitShares, currentShares);
    const ni = n(r.ni);
    const rev = n(r.rev);
    const eq = n(r.eq);
    const debt = grossDebt(r);
    const lastYear = rows.find((o) => o.d === `${Number(r.d.slice(0, 4)) - 1}${r.d.slice(4)}`);
    const prevNi = lastYear ? n(lastYear.ni) : null;
    return {
      date: r.d,
      label: quarterLabel(r.d),
      revenue: rev,
      ebit: n(r.ebit),
      netIncome: ni,
      netMargin: rev !== null && rev > 0 ? div(ni, rev) : null,
      lpa: ni !== null && shares ? (ni * 1000) / shares : null,
      dividendsPaid: n(r.div),
      equity: eq,
      grossDebt: debt,
      debtToEquity: eq !== null && eq > 0 ? div(debt, eq) : null,
      currentRatio: div(n(r.ca), n(r.cl)),
      netIncomeYoY: ni !== null && prevNi !== null && prevNi > 0 ? ni / prevNi - 1 : null,
    };
  });
}

const monthsApart = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * Últimos 12 meses: soma dos 4 trimestres mais recentes e balanço do último.
 * `price` é a cotação atual; `dps12m`, os proventos por ação dos últimos 12 meses, quando conhecidos.
 */
export function buildTtm(
  rows: QuarterRaw[],
  splits: Split[],
  unitShares: number,
  price: number | null,
  dps12m: number | null,
  currentShares: number | null = null,
): AnnualPoint | null {
  const last4 = rows.slice(-4);
  if (last4.length < 4) return null;
  for (let i = 1; i < 4; i++) if (monthsApart(last4[i - 1].d, last4[i].d) !== 3 || last4[i].con !== last4[0].con) return null;
  const sum = (k: "rev" | "ebit" | "ni" | "div") => (last4.every((r) => typeof r[k] === "number") ? last4.reduce((s, r) => s + (r[k] as number), 0) : null);
  const end = last4[3];
  const shares = quarterShares(end, splits, unitShares, currentShares);
  const perShare = (v: number | null) => (v !== null && shares ? (v * 1000) / shares : null);
  const ni = sum("ni");
  const rev = sum("rev");
  const ebit = sum("ebit");
  const paid = sum("div");
  const eq = n(end.eq);
  const debt = grossDebt(end);
  const lpa = perShare(ni);
  const vpa = perShare(eq);
  const dps = dps12m ?? perShare(paid);
  return {
    year: Number(end.d.slice(0, 4)),
    label: `12M até ${quarterLabel(end.d)}`,
    consolidated: end.con,
    revenue: rev,
    ebit,
    netIncome: ni,
    equity: eq,
    assets: n(end.assets),
    currentAssets: n(end.ca),
    currentLiabilities: n(end.cl),
    nonCurrentLiabilities: n(end.ncl),
    grossDebt: debt,
    cash: n(end.cash),
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
    ebitMargin: rev !== null && rev > 0 ? div(ebit, rev) : null,
    payout: ni !== null && ni > 0 ? div(paid, ni) : null,
    currentRatio: div(n(end.ca), n(end.cl)),
    debtToEquity: eq !== null && eq > 0 ? div(debt, eq) : null,
  };
}
