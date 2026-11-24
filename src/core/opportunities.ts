// Oportunidades para estudo: papéis líquidos, lucrativos e baratos pelos critérios de Graham e Bazin.
// É uma triagem por regras fixas, não uma recomendação de investimento.
import { fmtPct } from "./format";
import { defaultParams, getStrategy, runStrategy, type StrategyResult } from "./strategies";
import type { StockRow } from "./types";

export interface Opportunity {
  stock: StockRow;
  score: number;
  reasons: string[];
  graham: StrategyResult;
  defensive: StrategyResult;
  bazin: StrategyResult;
  /** Maior margem entre Nº de Graham e Bazin. */
  margin: number | null;
}

export interface OpportunityOptions {
  minLiquidity: number;
  limit: number;
  /** Situação na CVM (ex.: "Em Recuperação Judicial"); papéis fora de operação normal ficam de fora. */
  statusOf?: (stock: StockRow) => string | undefined;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const run = (s: StockRow, id: string) => runStrategy(s, { id, params: defaultParams(getStrategy(id)!) })!;

export function findOpportunities(rows: StockRow[], opts: OpportunityOptions = { minLiquidity: 1_000_000, limit: 15 }): Opportunity[] {
  // um papel por empresa: o mais líquido
  const best = new Map<string, StockRow>();
  for (const s of rows) {
    if (!(s.price > 0) || (s.liq2m ?? 0) < opts.minLiquidity) continue;
    const key = s.cnpj ?? s.ticker.slice(0, 4);
    const cur = best.get(key);
    if (!cur || (s.liq2m ?? 0) > (cur.liq2m ?? 0)) best.set(key, s);
  }

  const out: Opportunity[] = [];
  for (const s of best.values()) {
    const status = opts.statusOf?.(s);
    if (status && !/^fase operacional$/i.test(status)) continue;
    if (!(s.lpa && s.lpa > 0) || !(s.vpa && s.vpa > 0) || !(s.roe && s.roe >= 0.08)) continue;
    const graham = run(s, "graham-number");
    const defensive = run(s, "graham-defensive");
    const bazin = run(s, "bazin");
    const gm = graham.margin ?? -1;
    const bm = bazin.margin ?? -1;
    if (gm < 0.15 && bm < 0.1) continue;
    if (defensive.score < 4) continue;

    const debtScore = s.financial ? 0.5 : s.divPatrim === null ? 0.3 : clamp(1 - s.divPatrim / 2, 0, 1);
    const score =
      0.35 * (clamp(gm, 0, 0.6) / 0.6) +
      0.3 * (defensive.maxScore ? defensive.score / defensive.maxScore : 0) +
      0.15 * (clamp(bm, 0, 0.5) / 0.5) +
      0.1 * (clamp(s.roe, 0, 0.3) / 0.3) +
      0.1 * debtScore;

    const reasons: string[] = [];
    if (gm >= 0.15) reasons.push(`${fmtPct(gm, 0)} abaixo do Nº de Graham`);
    if (bm >= 0.1) reasons.push(`${fmtPct(bm, 0)} abaixo do teto de Bazin`);
    reasons.push(`${defensive.score}/${defensive.maxScore} critérios do investidor defensivo`);
    if (s.roe >= 0.15) reasons.push(`ROE de ${fmtPct(s.roe, 0)}`);
    if (s.dy && s.dy >= 0.06) reasons.push(`dividend yield de ${fmtPct(s.dy)}`);
    if (!s.financial && s.divPatrim !== null && s.divPatrim <= 0.5) reasons.push("dívida baixa");

    out.push({ stock: s, score, reasons, graham, defensive, bazin, margin: Math.max(gm, bm) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit);
}
