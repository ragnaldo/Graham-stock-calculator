// Formato da base embutida no HTML e montagem das linhas/detalhes a partir dela.
// TypeScript puro: roda no navegador (app web) e no Node (testes e scripts).
import { adjustPrices, buildAnnual, buildQuarters, buildTtm, splitFactorAfter, summarize, type AnnualRaw, type QuarterRaw, type Split } from "./history";
import type { Benchmarks } from "./portfolio";
import type { Vault } from "./vault";
import type { DividendEvent, Snapshot, StockDetail, StockRow } from "./types";

export interface Company {
  cnpj: string;
  name: string;
  sector: string;
  financial: boolean;
  tickers: Record<string, { kind: "ON" | "PN" | "UNIT"; unitShares?: number | null }>;
  gov?: Governance;
}

/** Governança e documentos (cadastro FCA, formulário de referência e índices DFP/ITR da CVM). */
export interface Governance {
  segment?: string;
  control?: string;
  status?: string;
  site?: string;
  about?: string;
  auditor?: string;
  auditorSince?: string;
  holders?: { controlPct: number | null; treasuryPct: number | null; freeFloatPct: number | null; top: { name: string; pct: number; controller: boolean }[]; date: string };
  docs?: { kind: "DFP" | "ITR"; date: string; link: string }[];
}

export interface PriceSeries {
  /** "YYYY-MM" -> último fechamento do mês (bruto). */
  m: Record<string, number>;
  last: string;
  splits?: Split[];
}

export type FundUnit = "brl" | "pct" | "x" | "n";

/** Dados da página de detalhes do Fundamentus, já convertidos. */
export interface TickerExtra {
  info: StockDetail["info"];
  /** [rótulo, valor, unidade] */
  f: [string, number | null, FundUnit][];
  /** Proventos: [data com, tipo, valor por ação na época, data de pagamento] */
  d: [string, string, number, string | null][] | null;
}

export interface WebDataset {
  /** Quando a lista de cotações e indicadores foi coletada (ISO). */
  quotesAt: string;
  /** Quando a base histórica (CVM/B3) foi gerada (ISO). */
  historyAt: string | null;
  lastFiscalYear: number | null;
  /** Fim do trimestre mais recente com balanço na base (YYYY-MM-DD). */
  lastQuarter?: string | null;
  snapshots: Snapshot[];
  companies: Company[];
  annual: Record<string, AnnualRaw[]>;
  /** Trimestres recentes por CNPJ (ITR). */
  quarters: Record<string, QuarterRaw[]>;
  prices: Record<string, PriceSeries>;
  extras: Record<string, TickerExtra>;
  /** CDI e Ibovespa diários, para comparar a carteira. */
  benchmarks?: Benchmarks | null;
  /** Endereço e chave da planilha, criptografados com a senha do dono. */
  access?: Vault | null;
}

export interface TickerData {
  company: Company;
  kind: "ON" | "PN" | "UNIT";
  /** Ações por unit (1 para ON/PN); null quando a composição não pôde ser lida. */
  unitShares: number | null;
  annual: AnnualRaw[];
  quarters: QuarterRaw[];
  monthly: Record<string, number>;
  splits: Split[];
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function indexDataset(ds: WebDataset) {
  const byTicker = new Map<string, Company>();
  for (const c of ds.companies) for (const t of Object.keys(c.tickers)) byTicker.set(t, c);
  return function tickerData(ticker: string): TickerData | null {
    const company = byTicker.get(ticker);
    if (!company) return null;
    const t = company.tickers[ticker];
    const series = ds.prices[ticker];
    return {
      company,
      kind: t.kind,
      unitShares: t.kind === "UNIT" ? (t.unitShares ?? null) : 1,
      annual: ds.annual[company.cnpj] ?? [],
      quarters: ds.quarters?.[company.cnpj] ?? [],
      monthly: series?.m ?? {},
      splits: series?.splits ?? [],
    };
  };
}

export function toRow(s: Snapshot, data: TickerData | null): StockRow {
  const marketCap = isNum(s.pvp) && isNum(s.patrimLiq) && s.pvp * s.patrimLiq > 0 ? s.pvp * s.patrimLiq : null;
  return {
    ...s,
    name: data?.company.name ?? null,
    sector: data?.company.sector ?? null,
    financial: data?.company.financial ?? false,
    cnpj: data?.company.cnpj ?? null,
    lpa: isNum(s.pl) ? s.price / s.pl : null,
    vpa: isNum(s.pvp) ? s.price / s.pvp : null,
    marketCap,
    revenue: marketCap !== null && isNum(s.psr) && s.psr > 0 ? marketCap / s.psr : null,
    history: data && data.unitShares ? summarize(data.annual, data.splits, data.unitShares) : null,
  };
}

// múltiplos do tipo preço / X: mudam na mesma proporção da cotação
const PRICE_MULTIPLES = ["pl", "pvp", "psr", "pAtivo", "pCapGiro", "pEbit", "pAcl"] as const;

/** Aplica uma cotação nova ao snapshot, recalculando os indicadores que dependem do preço. */
export function repriceSnapshot(s: Snapshot, price: number): Snapshot {
  if (!(price > 0) || !(s.price > 0) || price === s.price) return s;
  const k = price / s.price;
  const out: Snapshot = { ...s, price };
  for (const f of PRICE_MULTIPLES) if (isNum(s[f])) out[f] = (s[f] as number) * k;
  if (isNum(s.dy)) out.dy = s.dy / k;
  return out;
}

/** `today` (YYYY-MM-DD) define a janela de 12 meses dos proventos. */
export function buildDetail(row: StockRow, extra: TickerExtra | null, data: TickerData | null, today = new Date().toISOString().slice(0, 10)): Omit<StockDetail, "updatedAt"> {
  const warnings: string[] = [];
  const splits = data?.splits ?? [];
  const raw = extra?.d ?? null;
  const dividends: DividendEvent[] = (raw ?? []).map(([date, type, value, payDate]) => ({
    date,
    type,
    value: value / splitFactorAfter(splits, date),
    payDate,
  }));
  const byYear = new Map<number, number>();
  for (const d of dividends) {
    const y = Number(d.date.slice(0, 4));
    byYear.set(y, (byYear.get(y) ?? 0) + d.value);
  }
  if (!extra) warnings.push("Papel sem detalhes coletados: indicadores de balanço e proventos por ação indisponíveis.");
  else if (raw === null) warnings.push("Proventos por ação indisponíveis; usando os dividendos pagos informados à CVM.");

  let annual: StockDetail["annual"] = [];
  if (!data) warnings.push("Papel sem cadastro na base CVM: histórico anual indisponível.");
  else if (!data.unitShares) warnings.push("Composição da unit não identificada: valores por ação do histórico indisponíveis.");
  if (data) {
    // exercícios sem provento registrado contam como zero quando a série de proventos existe
    const dps = raw ? new Map(data.annual.map((r) => [r.y, byYear.get(r.y) ?? 0])) : undefined;
    annual = buildAnnual({ rows: data.annual, splits, unitShares: data.unitShares ?? Number.NaN, monthly: data.monthly, dpsByYear: dps });
    if (!annual.length) warnings.push("Empresa sem demonstrações anuais na base CVM.");
    if (!Object.keys(data.monthly).length) warnings.push("Sem histórico de preços na B3 para este código.");
  }

  // últimos 12 meses e trimestres (ITR)
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const dps12m = raw ? dividends.filter((d) => d.date > yearAgo && d.date <= today).reduce((s, d) => s + d.value, 0) : null;
  const unit = data?.unitShares ?? null;
  const current = extra?.info.shares ?? null;
  const quarters = data && unit ? buildQuarters(data.quarters, splits, unit, current) : [];
  const ttm = data && unit ? buildTtm(data.quarters, splits, unit, row.price, dps12m, current) : null;

  const empty: StockDetail["info"] = {
    company: null,
    type: null,
    sector: null,
    subsector: null,
    lastQuoteDate: null,
    lastBalanceDate: null,
    min52: null,
    max52: null,
    marketCap: null,
    enterpriseValue: null,
    shares: null,
    avgVolume2m: null,
  };
  return {
    row,
    info: extra?.info ?? empty,
    fundamentals: (extra?.f ?? []).map(([label, value, unit]) => ({ label, value, unit })),
    annual,
    ttm,
    quarters,
    prices: data ? adjustPrices(data.monthly, splits) : [],
    dividends,
    dividendsByYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, value]) => ({ year, value })),
    splits: splits.map(([date, factor]) => ({ date, factor })),
    gov: data?.company.gov ?? null,
    warnings,
  };
}
