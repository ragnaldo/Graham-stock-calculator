import { fmtCompact, fmtMultiple, fmtPct } from "../format";
import type { StockRow } from "../types";
import { bazin } from "./bazin";
import { grahamDefensive, grahamGrowth, grahamNetNet, grahamNumber } from "./graham";
import type { ActiveStrategy, Criterion, Evaluated, Params, ScreenConfig, Strategy, StrategyResult } from "./types";
import { finish, isNum } from "./util";

export * from "./types";

/** Indicadores disponíveis para regras livres. */
export const FIELDS: { key: keyof StockRow; label: string; kind: "x" | "pct" | "brl" }[] = [
  { key: "pl", label: "P/L", kind: "x" },
  { key: "pvp", label: "P/VP", kind: "x" },
  { key: "dy", label: "Dividend yield", kind: "pct" },
  { key: "roe", label: "ROE", kind: "pct" },
  { key: "roic", label: "ROIC", kind: "pct" },
  { key: "mrgLiq", label: "Margem líquida", kind: "pct" },
  { key: "mrgEbit", label: "Margem EBIT", kind: "pct" },
  { key: "liqCorr", label: "Liquidez corrente", kind: "x" },
  { key: "divPatrim", label: "Dívida / patrimônio", kind: "x" },
  { key: "evEbit", label: "EV/EBIT", kind: "x" },
  { key: "evEbitda", label: "EV/EBITDA", kind: "x" },
  { key: "psr", label: "PSR", kind: "x" },
  { key: "cresRec5a", label: "Cresc. receita 5a", kind: "pct" },
  { key: "marketCap", label: "Valor de mercado (R$ mi)", kind: "brl" },
];

const fmtField = (kind: "x" | "pct" | "brl", v: number | null) =>
  kind === "pct" ? fmtPct(v) : kind === "brl" ? fmtCompact(v) : fmtMultiple(v);

/** Filtro livre: lista de regras "indicador ≥/≤ valor". Base para testar outras estratégias. */
export const customFilter: Strategy = {
  id: "custom",
  name: "Filtro por indicadores",
  short: "Filtro",
  columns: [],
  description: "Regras livres sobre os indicadores (ex.: ROE ≥ 15%, dívida/patrimônio ≤ 1). Percentuais em %, valor de mercado em R$ milhões.",
  params: [],
  usesRules: true,
  evaluate(s, _p, rules) {
    const criteria: Criterion[] = rules.map((r, i) => {
      const f = FIELDS.find((x) => x.key === r.field);
      const raw = f ? (s[f.key] as number | null) : null;
      const scale = f?.kind === "pct" ? 100 : f?.kind === "brl" ? 1e-6 : 1;
      const v = isNum(raw) ? raw * scale : null;
      return {
        id: `rule-${i}`,
        label: f?.label ?? r.field,
        pass: v === null ? null : r.op === ">=" ? v >= r.value : v <= r.value,
        value: f ? fmtField(f.kind, raw) : "–",
        target: `${r.op === ">=" ? "≥" : "≤"} ${fmtMultiple(r.value)}${f?.kind === "pct" ? "%" : f?.kind === "brl" ? " mi" : ""}`,
      };
    });
    if (!criteria.length) return { pass: true, criteria, score: 0, maxScore: 0, fairValue: null, margin: null };
    return finish(criteria);
  },
};

/** Registro de estratégias. Para criar uma nova: implemente `Strategy` e adicione aqui. */
export const STRATEGIES: Strategy[] = [grahamNumber, grahamDefensive, grahamGrowth, grahamNetNet, bazin, customFilter];

export const getStrategy = (id: string) => STRATEGIES.find((s) => s.id === id);

export function defaultParams(strategy: Strategy): Params {
  return Object.fromEntries(strategy.params.map((p) => [p.key, p.default]));
}

export const DEFAULT_CONFIG: ScreenConfig = {
  active: [{ id: grahamNumber.id, params: defaultParams(grahamNumber) }],
  combine: "all",
  minLiquidity: 500_000,
  onePerCompany: true,
  showFailed: false,
};

export function runStrategy(stock: StockRow, active: ActiveStrategy): StrategyResult | null {
  const strategy = getStrategy(active.id);
  if (!strategy) return null;
  return strategy.evaluate(stock, { ...defaultParams(strategy), ...active.params }, active.rules ?? []);
}

/** Aplica universo (liquidez, um papel por empresa) e as estratégias ativas. */
export function screen(stocks: StockRow[], config: ScreenConfig): Evaluated[] {
  let universe = stocks.filter((s) => s.price > 0 && (s.liq2m ?? 0) >= config.minLiquidity);
  if (config.onePerCompany) {
    const best = new Map<string, StockRow>();
    for (const s of universe) {
      const key = s.cnpj ?? s.ticker.slice(0, 4);
      const cur = best.get(key);
      if (!cur || (s.liq2m ?? 0) > (cur.liq2m ?? 0)) best.set(key, s);
    }
    universe = [...best.values()];
  }
  return universe.map((stock) => {
    const results: Record<string, StrategyResult> = {};
    for (const a of config.active) {
      const r = runStrategy(stock, a);
      if (r) results[a.id] = r;
    }
    const verdicts = Object.values(results).map((r) => r.pass === true);
    const pass = verdicts.length === 0 ? true : config.combine === "all" ? verdicts.every(Boolean) : verdicts.some(Boolean);
    return { stock, results, pass };
  });
}
