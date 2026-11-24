// Carteira: operações -> posições, preço médio, proventos, resultado e comparação com Ibovespa e CDI.
// TypeScript puro; as operações ficam no navegador do usuário.
import { splitFactorAfter, type Split } from "./history";

export interface Benchmarks {
  updatedAt: string;
  /** Índice acumulado do CDI ao fim de cada dia útil. */
  cdi: [string, number][];
  /** Fechamento diário do Ibovespa (índice de retorno total: já reinveste proventos). */
  ibov: [string, number][];
}

export interface Operation {
  id: string;
  ticker: string;
  /** C = compra, V = venda */
  type: "C" | "V";
  /** YYYY-MM-DD */
  date: string;
  /** Quantidade na data da operação (antes de desdobramentos posteriores). */
  qty: number;
  /** Preço por ação na data da operação. */
  price: number;
  /** Taxas e corretagem da operação (R$). */
  fees?: number;
}

export interface PortfolioContext {
  today: string;
  /** Cotação atual (base de hoje). */
  price(ticker: string): number | null;
  splits(ticker: string): Split[];
  /** Proventos por ação na base de hoje, por data com. */
  dividends(ticker: string): { date: string; value: number }[];
  /** "YYYY-MM" -> fechamento mensal bruto (base da época). */
  monthly(ticker: string): Record<string, number>;
  name(ticker: string): string | null;
  sector(ticker: string): string | null;
}

export interface Position {
  ticker: string;
  name: string | null;
  sector: string | null;
  /** Quantidade hoje, já corrigida por desdobramentos e grupamentos. */
  qty: number;
  /** Preço médio na base de hoje. */
  avgPrice: number;
  /** Custo da posição em aberto (quantidade × preço médio). */
  cost: number;
  price: number | null;
  value: number;
  /** Valorização da posição em aberto (R$). */
  gain: number;
  gainPct: number | null;
  /** Proventos recebidos desde a primeira compra (dividendos + JCP, por data com). */
  dividends: number;
  /** Lucro realizado em vendas. */
  realized: number;
  weight: number;
  firstBuy: string;
}

export interface Comparison {
  /** Patrimônio final de cada alternativa, com os mesmos aportes e retiradas. */
  value: number;
  /** Resultado sobre o total aportado. */
  returnPct: number;
}

export interface SeriesPoint {
  /** YYYY-MM-DD */
  date: string;
  portfolio: number | null;
  ibov: number | null;
  cdi: number | null;
}

export interface PortfolioSummary {
  positions: Position[];
  closed: { ticker: string; realized: number; dividends: number }[];
  /** Soma de todas as compras (com taxas). */
  contributed: number;
  /** Recebido em vendas (líquido de taxas). */
  withdrawn: number;
  value: number;
  cost: number;
  dividends: number;
  realized: number;
  /** Resultado total: patrimônio + vendas + proventos − compras. */
  result: number;
  returnPct: number | null;
  ibov: Comparison | null;
  cdi: Comparison | null;
  series: SeriesPoint[];
  bySector: { sector: string; value: number; weight: number }[];
  warnings: string[];
  firstDate: string | null;
}

/** Último valor da série com data até `date` (séries ordenadas por data). */
export function valueAt(series: [string, number][], date: string): number | null {
  let lo = 0;
  let hi = series.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? series[found][1] : null;
}

const byDate = (a: Operation, b: Operation) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === "C" ? -1 : 1);

/** Operação trazida à base de ações de hoje. */
function normalize(op: Operation, splits: Split[]) {
  const f = splitFactorAfter(splits, op.date);
  return { ...op, qty: op.qty * f, price: op.price / f };
}

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Simula os mesmos aportes e retiradas em um índice; devolve patrimônio na data. */
function mirror(flows: { date: string; amount: number }[], series: [string, number][], at: string): number | null {
  let units = 0;
  for (const f of flows) {
    if (f.date > at) break;
    const v = valueAt(series, f.date) ?? series[0]?.[1];
    if (!v) return null;
    units = Math.max(0, units + f.amount / v);
  }
  const end = valueAt(series, at);
  return end === null ? null : units * end;
}

export function computePortfolio(ops: Operation[], ctx: PortfolioContext, bench: Benchmarks | null): PortfolioSummary {
  const warnings: string[] = [];
  const valid = ops.filter((o) => o.qty > 0 && o.price > 0 && o.date <= ctx.today).sort(byDate);
  if (valid.length < ops.length) warnings.push("Operações com data futura ou quantidade/preço inválidos foram ignoradas.");
  const tickers = [...new Set(valid.map((o) => o.ticker))];

  const positions: Position[] = [];
  const closed: PortfolioSummary["closed"] = [];
  // fluxos de caixa: compra = aporte (+), venda e proventos = retirada (−)
  const flows: { date: string; amount: number }[] = [];
  const dividendFlows: { date: string; amount: number }[] = [];
  let contributed = 0;
  let withdrawn = 0;

  for (const t of tickers) {
    const splits = ctx.splits(t);
    const list = valid.filter((o) => o.ticker === t).map((o) => normalize(o, splits));
    let qty = 0;
    let cost = 0;
    let realized = 0;
    for (const o of list) {
      const fees = o.fees ?? 0;
      if (o.type === "C") {
        const amount = o.qty * o.price + fees;
        cost += amount;
        qty += o.qty;
        contributed += amount;
        flows.push({ date: o.date, amount });
      } else {
        const sellQty = Math.min(o.qty, qty);
        if (sellQty < o.qty - 1e-6) warnings.push(`${t}: venda de ${o.date} maior que a posição; considerada só a quantidade disponível.`);
        if (sellQty <= 0) continue;
        const avg = cost / qty;
        const proceeds = sellQty * o.price - fees;
        realized += proceeds - sellQty * avg;
        cost -= sellQty * avg;
        qty -= sellQty;
        withdrawn += proceeds;
        flows.push({ date: o.date, amount: -proceeds });
      }
    }
    // proventos: ações em posse ao fim da data com
    let dividends = 0;
    for (const d of ctx.dividends(t)) {
      if (d.date > ctx.today) continue;
      let held = 0;
      for (const o of list) if (o.date <= d.date) held += o.type === "C" ? o.qty : -o.qty;
      if (held > 1e-9) {
        const amount = held * d.value;
        dividends += amount;
        dividendFlows.push({ date: d.date, amount });
      }
    }
    if (qty > 1e-9) {
      const price = ctx.price(t);
      if (price === null) warnings.push(`${t}: sem cotação atual; avaliado pelo preço médio.`);
      const value = qty * (price ?? cost / qty);
      positions.push({
        ticker: t,
        name: ctx.name(t),
        sector: ctx.sector(t),
        qty,
        avgPrice: cost / qty,
        cost,
        price,
        value,
        gain: value - cost,
        gainPct: cost > 0 ? value / cost - 1 : null,
        dividends,
        realized,
        weight: 0,
        firstBuy: list.find((o) => o.type === "C")?.date ?? list[0].date,
      });
    } else closed.push({ ticker: t, realized, dividends });
  }

  const value = positions.reduce((s, p) => s + p.value, 0);
  for (const p of positions) p.weight = value > 0 ? p.value / value : 0;
  positions.sort((a, b) => b.value - a.value);
  const dividends = positions.reduce((s, p) => s + p.dividends, 0) + closed.reduce((s, c) => s + c.dividends, 0);
  const realized = positions.reduce((s, p) => s + p.realized, 0) + closed.reduce((s, c) => s + c.realized, 0);
  const result = value + withdrawn + dividends - contributed;

  flows.sort((a, b) => a.date.localeCompare(b.date));
  const compare = (series: [string, number][] | undefined): Comparison | null => {
    if (!series?.length || !contributed) return null;
    const v = mirror(flows, series, ctx.today);
    return v === null ? null : { value: v, returnPct: (v + withdrawn - contributed) / contributed };
  };

  // série mensal da rentabilidade acumulada (fechamentos de mês + hoje)
  const firstDate = flows[0]?.date ?? null;
  const series: SeriesPoint[] = [];
  if (firstDate) {
    const months = monthsBetween(firstDate, ctx.today);
    const dates = months.map((m) => (monthEnd(m) < ctx.today ? monthEnd(m) : ctx.today));
    const normalized = new Map(tickers.map((t) => [t, valid.filter((o) => o.ticker === t).map((o) => normalize(o, ctx.splits(t)))]));
    for (const date of [firstDate, ...dates.filter((d) => d > firstDate)]) {
      const isToday = date === ctx.today;
      let val = 0;
      let inflow = 0;
      let outflow = 0;
      for (const f of flows) if (f.date <= date) (f.amount > 0 ? (inflow += f.amount) : (outflow -= f.amount));
      for (const f of dividendFlows) if (f.date <= date) outflow += f.amount;
      for (const t of tickers) {
        let q = 0;
        let lastPrice = 0;
        for (const o of normalized.get(t)!) {
          if (o.date > date) break;
          q += o.type === "C" ? o.qty : -o.qty;
          lastPrice = o.price;
        }
        if (q <= 1e-9) continue;
        let px: number | null = isToday ? ctx.price(t) : null;
        if (px === null && !isToday) {
          const raw = ctx.monthly(t)[date.slice(0, 7)];
          // preço de fechamento do mês na base de hoje; antes do fim do mês da compra vale o preço pago
          if (raw && date !== firstDate) px = raw / splitFactorAfter(ctx.splits(t), date);
        }
        val += q * (px ?? lastPrice);
      }
      const pct = (x: number) => (inflow > 0 ? (x + outflow - inflow) / inflow : null);
      const mirrorPct = (s?: [string, number][]) => {
        if (!s?.length) return null;
        const v = mirror(flows, s, date);
        let out = 0;
        for (const f of flows) if (f.date <= date && f.amount < 0) out -= f.amount;
        return v === null || inflow <= 0 ? null : (v + out - inflow) / inflow;
      };
      series.push({ date, portfolio: pct(val), ibov: mirrorPct(bench?.ibov), cdi: mirrorPct(bench?.cdi) });
    }
  }

  const sectors = new Map<string, number>();
  for (const p of positions) sectors.set(p.sector ?? "Outros", (sectors.get(p.sector ?? "Outros") ?? 0) + p.value);

  return {
    positions,
    closed,
    contributed,
    withdrawn,
    value,
    cost: positions.reduce((s, p) => s + p.cost, 0),
    dividends,
    realized,
    result,
    returnPct: contributed > 0 ? result / contributed : null,
    ibov: compare(bench?.ibov),
    cdi: compare(bench?.cdi),
    series,
    bySector: [...sectors.entries()].map(([sector, v]) => ({ sector, value: v, weight: value > 0 ? v / value : 0 })).sort((a, b) => b.value - a.value),
    warnings: [...new Set(warnings)],
    firstDate,
  };
}

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Lê um backup exportado (JSON) e valida as operações. */
export function parseBackup(text: string): Operation[] {
  const data = JSON.parse(text) as { operations?: unknown } | unknown[];
  const list = Array.isArray(data) ? data : (data as { operations?: unknown }).operations;
  if (!Array.isArray(list)) throw new Error("arquivo sem a lista de operações");
  return list.map((raw, i) => {
    const o = raw as Partial<Operation>;
    const ok =
      typeof o.ticker === "string" &&
      /^[A-Z0-9]{4}\d{1,2}$/.test(o.ticker.toUpperCase()) &&
      (o.type === "C" || o.type === "V") &&
      typeof o.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.date) &&
      typeof o.qty === "number" &&
      o.qty > 0 &&
      typeof o.price === "number" &&
      o.price > 0;
    if (!ok) throw new Error(`operação ${i + 1} inválida`);
    return { id: typeof o.id === "string" ? o.id : newId(), ticker: o.ticker!.toUpperCase(), type: o.type!, date: o.date!, qty: o.qty!, price: o.price!, fees: typeof o.fees === "number" && o.fees > 0 ? o.fees : undefined };
  });
}
