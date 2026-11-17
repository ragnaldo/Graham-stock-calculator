// Tipos de domínio. Este diretório (src/core) é TypeScript puro, sem React/Next,
// para ser reaproveitado no futuro app mobile.

/** Indicadores atuais de um papel (fonte: Fundamentus). Percentuais em fração (0.08 = 8%). */
export interface Snapshot {
  ticker: string;
  price: number;
  pl: number | null;
  pvp: number | null;
  psr: number | null;
  dy: number | null;
  pAtivo: number | null;
  pCapGiro: number | null;
  pEbit: number | null;
  /** Preço / ativo circulante líquido por ação (NCAV). */
  pAcl: number | null;
  evEbit: number | null;
  evEbitda: number | null;
  mrgBruta: number | null;
  mrgEbit: number | null;
  mrgLiq: number | null;
  liqCorr: number | null;
  roic: number | null;
  roe: number | null;
  /** Volume financeiro médio diário dos últimos 2 meses (R$). */
  liq2m: number | null;
  patrimLiq: number | null;
  divPatrim: number | null;
  cresRec5a: number | null;
}

/** Resumo do histórico anual (CVM) usado pelos filtros. Valores em R$ mil. */
export interface HistorySummary {
  years: number[];
  netIncome: (number | null)[];
  dividends: (number | null)[];
  /** Divisor para valores por ação já ajustado por desdobramentos e composição de units. */
  shares: (number | null)[];
  balance?: { year: number; ca?: number; cl?: number; ncl?: number; debtL?: number; rev?: number };
}

/** Linha avaliada pelas estratégias: snapshot + cadastro + histórico. */
export interface StockRow extends Snapshot {
  name: string | null;
  sector: string | null;
  financial: boolean;
  cnpj: string | null;
  lpa: number | null;
  vpa: number | null;
  marketCap: number | null;
  /** Receita líquida 12 meses (R$), derivada de valor de mercado / PSR. */
  revenue: number | null;
  history: HistorySummary | null;
}

export interface StocksPayload {
  updatedAt: string;
  source: string;
  dataset: { updatedAt: string | null; lastYear: number | null };
  stocks: StockRow[];
}

// ---------- detalhe ----------
export interface AnnualPoint {
  year: number;
  /** Rótulo quando não é um exercício fechado (ex.: "12M até 3T26"). */
  label?: string;
  consolidated: boolean;
  revenue: number | null;
  ebit: number | null;
  netIncome: number | null;
  equity: number | null;
  assets: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  nonCurrentLiabilities: number | null;
  grossDebt: number | null;
  cash: number | null;
  dividendsPaid: number | null;
  /** Por ação, ajustados por desdobramentos. */
  lpa: number | null;
  vpa: number | null;
  dps: number | null;
  /** Fechamento do último pregão do ano, ajustado por desdobramentos. */
  price: number | null;
  pl: number | null;
  pvp: number | null;
  dy: number | null;
  roe: number | null;
  netMargin: number | null;
  ebitMargin: number | null;
  payout: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
}

export interface DividendEvent {
  date: string;
  type: string;
  /** Valor por ação, ajustado por desdobramentos. */
  value: number;
  payDate: string | null;
}

export interface StockDetail {
  row: StockRow;
  updatedAt: string;
  info: {
    company: string | null;
    type: string | null;
    sector: string | null;
    subsector: string | null;
    lastQuoteDate: string | null;
    lastBalanceDate: string | null;
    min52: number | null;
    max52: number | null;
    marketCap: number | null;
    enterpriseValue: number | null;
    shares: number | null;
    avgVolume2m: number | null;
  };
  /** Rótulo -> valor bruto da página de detalhes (balanço e resultado). */
  fundamentals: { label: string; value: number | null; unit: "brl" | "pct" | "x" | "n" }[];
  annual: AnnualPoint[];
  /** Últimos 12 meses (4 trimestres mais recentes), quando disponível. */
  ttm: AnnualPoint | null;
  quarters: QuarterPoint[];
  prices: { month: string; close: number }[];
  dividends: DividendEvent[];
  dividendsByYear: { year: number; value: number }[];
  splits: { date: string; factor: number }[];
  warnings: string[];
}

/** Resultado de um trimestre (3 meses) e balanço no fim dele. Valores em R$ mil, por ação em R$. */
export interface QuarterPoint {
  date: string;
  /** "3T26" */
  label: string;
  revenue: number | null;
  ebit: number | null;
  netIncome: number | null;
  netMargin: number | null;
  lpa: number | null;
  dividendsPaid: number | null;
  equity: number | null;
  grossDebt: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  /** Variação do lucro sobre o mesmo trimestre do ano anterior. */
  netIncomeYoY: number | null;
}
