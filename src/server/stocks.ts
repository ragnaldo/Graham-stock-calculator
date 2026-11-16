import { adjustPrices, buildAnnual, splitFactorAfter, summarize } from "@/core/history";
import type { DividendEvent, Snapshot, StockDetail, StockRow, StocksPayload } from "@/core/types";
import { cached, clearCache } from "./cache";
import { datasetMeta, tickerData } from "./dataset";
import { fetchDetails, fetchDividends, fetchList, parseBR, type Details } from "./fundamentus";

const LIST_TTL = 12 * 60 * 60 * 1000;
const DETAIL_TTL = 6 * 60 * 60 * 1000;
const SOURCE = "Fundamentus (cotações e indicadores) · CVM e B3 (histórico)";

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

function toRow(s: Snapshot): StockRow {
  const data = tickerData(s.ticker);
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

export async function getStocks(force = false): Promise<StocksPayload & { stale: boolean }> {
  const list = await cached("list", LIST_TTL, fetchList, force);
  return {
    updatedAt: new Date(list.at).toISOString(),
    source: SOURCE,
    dataset: datasetMeta(),
    stocks: list.value.map(toRow),
    stale: list.stale,
  };
}

let lastRefresh = 0;
/** Recarrega cotações e fundamentos; limita a uma chamada a cada 30 s. */
export async function refreshStocks() {
  if (Date.now() - lastRefresh < 30_000) return getStocks(false);
  lastRefresh = Date.now();
  clearCache("detail:");
  return getStocks(true);
}

const FUNDAMENTALS: [key: string, label: string, unit: "brl" | "pct" | "x" | "n"][] = [
  ["pl", "P/L", "x"],
  ["pvp", "P/VP", "x"],
  ["lpa", "LPA", "brl"],
  ["vpa", "VPA", "brl"],
  ["divyield", "Dividend yield", "pct"],
  ["pebit", "P/EBIT", "x"],
  ["psr", "PSR", "x"],
  ["pativos", "P/Ativos", "x"],
  ["pcapgiro", "P/Cap. giro", "x"],
  ["pativcircliq", "P/Ativ. circ. líq.", "x"],
  ["evebitda", "EV/EBITDA", "x"],
  ["evebit", "EV/EBIT", "x"],
  ["margbruta", "Margem bruta", "pct"],
  ["margebit", "Margem EBIT", "pct"],
  ["margliquida", "Margem líquida", "pct"],
  ["ebitativo", "EBIT/Ativo", "pct"],
  ["roic", "ROIC", "pct"],
  ["roe", "ROE", "pct"],
  ["liquidezcorr", "Liquidez corrente", "x"],
  ["divbrpatrim", "Dív. bruta/Patrimônio", "x"],
  ["divliqpatrim", "Dív. líquida/Patrimônio", "x"],
  ["giroativos", "Giro dos ativos", "x"],
  ["cresrec5a", "Cresc. receita (5a)", "pct"],
  ["ativo", "Ativo total", "brl"],
  ["ativocirculante", "Ativo circulante", "brl"],
  ["disponibilidades", "Disponibilidades", "brl"],
  ["divbruta", "Dívida bruta", "brl"],
  ["divliquida", "Dívida líquida", "brl"],
  ["patrimliq", "Patrimônio líquido", "brl"],
  ["receitaliquida", "Receita líquida (12m)", "brl"],
  ["ebit", "EBIT (12m)", "brl"],
  ["lucroliquido", "Lucro líquido (12m)", "brl"],
  ["receitaliquida#2", "Receita líquida (3m)", "brl"],
  ["ebit#2", "EBIT (3m)", "brl"],
  ["lucroliquido#2", "Lucro líquido (3m)", "brl"],
  // bancos
  ["cartdecredito", "Carteira de crédito", "brl"],
  ["depositos", "Depósitos", "brl"],
  ["resultintfinanc", "Result. int. financ. (12m)", "brl"],
  ["recservicos", "Receita de serviços (12m)", "brl"],
];

const brDate = (s: string | undefined) => {
  const m = s ? /(\d{2})\/(\d{2})\/(\d{4})/.exec(s) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

async function loadDetail(ticker: string): Promise<Omit<StockDetail, "row" | "updatedAt"> & { details: Record<string, string> }> {
  const [details, rawDividends] = await Promise.all([
    fetchDetails(ticker),
    fetchDividends(ticker).catch(() => null),
  ]);
  const data = tickerData(ticker);
  const warnings: string[] = [];
  const f = (k: string) => parseBR(details.fields.get(k) ?? "");
  const text = (k: string) => details.fields.get(k) || null;

  const splits = data?.splits ?? [];
  const dividends: DividendEvent[] = (rawDividends ?? []).map((d) => ({
    date: d.date,
    type: d.type,
    value: d.value / splitFactorAfter(splits, d.date),
    payDate: d.payDate,
  }));
  const byYear = new Map<number, number>();
  for (const d of dividends) {
    const y = Number(d.date.slice(0, 4));
    byYear.set(y, (byYear.get(y) ?? 0) + d.value);
  }
  if (rawDividends === null) warnings.push("Não foi possível ler os proventos por ação; usando os dividendos pagos informados à CVM.");

  let annual: StockDetail["annual"] = [];
  if (!data) warnings.push("Papel sem cadastro na base CVM: histórico anual indisponível.");
  else if (!data.unitShares) warnings.push("Composição da unit não identificada: valores por ação do histórico indisponíveis.");
  if (data) {
    // exercícios sem provento registrado contam como zero quando a série de proventos existe
    const dps = rawDividends ? new Map(data.annual.map((r) => [r.y, byYear.get(r.y) ?? 0])) : undefined;
    annual = buildAnnual({ rows: data.annual, splits, unitShares: data.unitShares ?? Number.NaN, monthly: data.monthly, dpsByYear: dps });
    if (!annual.length) warnings.push("Empresa sem demonstrações anuais na base CVM.");
    if (!Object.keys(data.monthly).length) warnings.push("Sem histórico de preços na B3 para este código.");
  }

  return {
    info: {
      company: text("empresa"),
      type: text("tipo"),
      sector: text("setor"),
      subsector: text("subsetor"),
      lastQuoteDate: brDate(details.fields.get("dataultcot")),
      lastBalanceDate: brDate(details.fields.get("ultbalancoprocessado")),
      min52: f("min52sem"),
      max52: f("max52sem"),
      marketCap: f("valordemercado"),
      enterpriseValue: f("valordafirma"),
      shares: f("nroacoes"),
      avgVolume2m: f("volmed2m"),
    },
    fundamentals: FUNDAMENTALS.filter(([k]) => details.fields.has(k)).map(([k, label, unit]) => ({ label, value: f(k), unit })),
    annual,
    prices: data ? adjustPrices(data.monthly, splits) : [],
    dividends,
    dividendsByYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, value]) => ({ year, value })),
    splits: splits.map(([date, factor]) => ({ date, factor })),
    warnings,
    details: Object.fromEntries(details.fields as Details["fields"]),
  };
}

export async function getStockDetail(ticker: string, force = false): Promise<(StockDetail & { stale: boolean }) | null> {
  const t = ticker.toUpperCase();
  if (!/^[A-Z0-9]{4}\d{1,2}$/.test(t)) return null;
  const list = await getStocks(false);
  const row = list.stocks.find((s) => s.ticker === t);
  if (!row) return null;
  const detail = await cached(`detail:${t}`, DETAIL_TTL, () => loadDetail(t), force);
  const { details: _raw, ...rest } = detail.value;
  void _raw;
  return { row, updatedAt: new Date(detail.at).toISOString(), ...rest, stale: detail.stale };
}
