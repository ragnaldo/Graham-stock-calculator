// Dados do app web.
// - Ao abrir: base embutida no HTML (funciona sem internet).
// - Atualizar: 1) baixa a base mais recente publicada pelo workflow no GitHub Pages
//   (indicadores do Fundamentus e balanços anuais/trimestrais da CVM, coletados todo dia útil);
//   2) aplica as cotações ao vivo da brapi.
import { buildDetail, indexDataset, repriceSnapshot, toRow, type Company, type WebDataset } from "@/core/dataset";
import { splitFactorAfter } from "@/core/history";
import type { Benchmarks, PortfolioContext } from "@/core/portfolio";
import type { StockDetail, StocksPayload } from "@/core/types";

declare const __DATA_URL__: string;

/** Base publicada junto com o site. Definida no build (scripts/build-web.ts). */
const DATA_URL = __DATA_URL__;
const QUOTES_URL = "https://brapi.dev/api/quote/list?type=stock&limit=2000";
const STORE_KEY = "graham:quotes:v1";
const SOURCE = "Fundamentus (indicadores) · CVM (balanços anuais e trimestrais) · B3 (preços históricos) · brapi (cotações ao vivo)";

interface LiveQuotes {
  at: string;
  prices: Record<string, number>;
}

function readEmbedded(): WebDataset {
  const el = document.getElementById("dataset");
  if (!el?.textContent) throw new Error("Base de dados não encontrada no arquivo.");
  return JSON.parse(el.textContent) as WebDataset;
}

let ds = readEmbedded();
let tickerData = indexDataset(ds);

function loadLive(): LiveQuotes | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const q = JSON.parse(raw) as LiveQuotes;
    // cotações salvas mais antigas que a base não valem
    return q.at > ds.quotesAt ? q : null;
  } catch {
    return null;
  }
}

let live = loadLive();
let payload: StocksPayload | null = null;

function build(): StocksPayload {
  const snaps = live ? ds.snapshots.map((s) => (live!.prices[s.ticker] ? repriceSnapshot(s, live!.prices[s.ticker]) : s)) : ds.snapshots;
  return {
    updatedAt: live?.at ?? ds.quotesAt,
    source: SOURCE,
    dataset: { updatedAt: ds.historyAt, lastYear: ds.lastFiscalYear },
    stocks: snaps.map((s) => toRow(s, tickerData(s.ticker))),
  };
}

export function getStocks(): StocksPayload & { live: boolean; baseAt: string; lastQuarter: string | null } {
  payload ??= build();
  return { ...payload, live: !!live, baseAt: ds.quotesAt, lastQuarter: ds.lastQuarter ?? null };
}

const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Baixa a base publicada mais recente. Devolve true se trocou a base em uso. */
async function refreshFundamentals(): Promise<boolean> {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`a base publicada respondeu ${res.status}`);
  const next = (await res.json()) as WebDataset;
  if (!next.snapshots?.length) throw new Error("a base publicada veio vazia");
  if (next.quotesAt <= ds.quotesAt) return false;
  ds = next;
  tickerData = indexDataset(ds);
  if (live && live.at <= ds.quotesAt) live = null;
  return true;
}

/** Busca cotações atuais e recalcula os indicadores que dependem do preço. */
async function refreshQuotes(): Promise<number> {
  const res = await fetch(QUOTES_URL, { cache: "no-store" });
  if (res.status === 429) throw new Error("limite de consultas da brapi atingido; tente de novo em 1 minuto");
  if (!res.ok) throw new Error(`a brapi respondeu ${res.status}`);
  const body = (await res.json()) as { stocks?: { stock: string; close: number | null }[] };
  const known = new Set(ds.snapshots.map((s) => s.ticker));
  const prices: Record<string, number> = {};
  for (const q of body.stocks ?? []) if (known.has(q.stock) && typeof q.close === "number" && q.close > 0) prices[q.stock] = q.close;
  const updated = Object.keys(prices).length;
  if (!updated) throw new Error("a brapi não devolveu preços");
  live = { at: new Date().toISOString(), prices };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(live));
  } catch {
    // sem armazenamento: vale só nesta visita
  }
  return updated;
}

const reason = (e: unknown) => (e instanceof TypeError ? "sem conexão" : (e as Error).message);

export interface RefreshResult {
  /** Mensagem de sucesso (pode ser parcial). */
  message: string;
  /** Avisos de partes que falharam. */
  warning: string | null;
}

/**
 * Atualizar: fundamentos mais recentes publicados + cotações ao vivo.
 * Rejeita só quando nada pôde ser atualizado.
 */
// ---------- aviso de dados novos para as telas ----------
let version = 0;
const listeners = new Set<() => void>();
export const dataVersion = () => version;
export function subscribeData(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed() {
  version++;
  listeners.forEach((fn) => fn());
}

export async function refreshAll(): Promise<RefreshResult> {
  try {
    return await refreshInner();
  } finally {
    changed();
  }
}

async function refreshInner(): Promise<RefreshResult> {
  // em sequência: as cotações ao vivo valem sobre a base que acabou de chegar
  const settle = <T,>(p: Promise<T>) => p.then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason }));
  const f = await settle(refreshFundamentals());
  const q = await settle(refreshQuotes());
  payload = build();
  const done: string[] = [];
  const failed: string[] = [];
  if (f.status === "fulfilled") {
    const quarter = ds.lastQuarter ? `, balanços até ${quarterName(ds.lastQuarter)}` : "";
    done.push(f.value ? `Fundamentos atualizados para a coleta de ${fmt(ds.quotesAt)}${quarter}.` : `Fundamentos já eram os mais recentes (coleta de ${fmt(ds.quotesAt)}${quarter}).`);
  } else failed.push(`fundamentos (${reason(f.reason)})`);
  if (q.status === "fulfilled") done.push(`Cotações ao vivo de ${q.value} papéis aplicadas; P/L, P/VP, DY e margens recalculados.`);
  else failed.push(`cotações ao vivo (${reason(q.reason)})`);

  if (!done.length) {
    throw new Error(
      `não foi possível buscar ${failed.join(" nem ")}. Isso acontece sem internet ou com a página aberta dentro do claude.ai, que bloqueia acesso a outros sites. Os dados exibidos são de ${fmt(ds.quotesAt)}.`,
    );
  }
  return { message: done.join(" "), warning: failed.length ? `Não atualizou: ${failed.join("; ")}.` : null };
}

const quarterName = (d: string) => `${Math.ceil(Number(d.slice(5, 7)) / 3)}T${d.slice(2, 4)}`;

export function getDetail(ticker: string): StockDetail | null {
  const row = getStocks().stocks.find((s) => s.ticker === ticker);
  if (!row) return null;
  const detail = buildDetail(row, ds.extras[ticker] ?? null, tickerData(ticker));
  return { ...detail, updatedAt: ds.quotesAt };
}

export const getBenchmarks = (): Benchmarks | null => ds.benchmarks ?? null;
export const getCompany = (ticker: string): Company | null => tickerData(ticker)?.company ?? null;

/** Papéis para escolher na carteira: código, nome e cotação atual. */
export function tickerOptions(): { ticker: string; name: string | null; price: number }[] {
  return getStocks().stocks.map((s) => ({ ticker: s.ticker, name: s.name, price: s.price }));
}

/** Fechamento mensal do papel no mês da data (base da época), para sugerir o preço de uma compra antiga. */
export function priceOn(ticker: string, date: string): number | null {
  const td = tickerData(ticker);
  return td?.monthly[date.slice(0, 7)] ?? null;
}

export function portfolioContext(today = new Date().toISOString().slice(0, 10)): PortfolioContext {
  const rows = new Map(getStocks().stocks.map((s) => [s.ticker, s]));
  return {
    today,
    price: (t) => rows.get(t)?.price ?? null,
    splits: (t) => tickerData(t)?.splits ?? [],
    dividends: (t) => {
      const raw = ds.extras[t]?.d;
      if (!raw) return [];
      const splits = tickerData(t)?.splits ?? [];
      return raw.map(([date, , value]) => ({ date, value: value / splitFactorAfter(splits, date) }));
    },
    monthly: (t) => tickerData(t)?.monthly ?? {},
    name: (t) => rows.get(t)?.name ?? null,
    sector: (t) => rows.get(t)?.sector ?? null,
  };
}
