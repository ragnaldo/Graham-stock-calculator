import type { HistorySummary, StockRow } from "../types";
import type { Criterion, StrategyResult, Verdict } from "./types";

export const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
export const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export interface YearValue {
  year: number;
  netIncome: number | null;
  dividends: number | null;
  /** Lucro por ação ajustado (R$). */
  eps: number | null;
}

/** Últimos `n` exercícios disponíveis, do mais antigo ao mais recente. */
export function lastYears(h: HistorySummary | null, n: number): YearValue[] {
  if (!h) return [];
  const rows = h.years.map((year, i) => {
    const ni = h.netIncome[i];
    const sh = h.shares[i];
    return {
      year,
      netIncome: ni,
      dividends: h.dividends[i],
      eps: isNum(ni) && isNum(sh) && sh > 0 ? (ni * 1000) / sh : null,
    };
  });
  return rows.slice(-n);
}

/** Lucro por ação médio dos últimos 3 exercícios; recorre ao lucro total / ações atuais. */
export function avgEps3(stock: StockRow): number | null {
  const last = lastYears(stock.history, 3);
  if (last.length < 3) return null;
  if (last.every((r) => isNum(r.eps))) return avg(last.map((r) => r.eps as number));
  if (last.every((r) => isNum(r.netIncome)) && isNum(stock.marketCap) && stock.price > 0) {
    const sharesNow = stock.marketCap / stock.price;
    return (avg(last.map((r) => r.netIncome as number)) * 1000) / sharesNow;
  }
  return null;
}

export function finish(criteria: Criterion[], opts: { minCriteria?: number; fairValue?: number | null; price?: number } = {}): StrategyResult {
  const applicable = criteria.filter((c) => !c.na);
  const score = applicable.filter((c) => c.pass === true).length;
  const required = Math.min(opts.minCriteria ?? applicable.length, applicable.length);
  let pass: Verdict = applicable.length > 0 && score >= required;
  // sem nenhum dado conclusivo => indefinido em vez de reprovado
  if (!pass && applicable.every((c) => c.pass === null)) pass = null;
  const fairValue = isNum(opts.fairValue) && opts.fairValue > 0 ? opts.fairValue : null;
  const margin = fairValue !== null && isNum(opts.price) && opts.price > 0 ? 1 - opts.price / fairValue : null;
  return { pass, criteria, score, maxScore: applicable.length, fairValue, margin };
}
