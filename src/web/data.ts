// Dados do app web: base embutida no HTML + cotações ao vivo (brapi) ao clicar em Atualizar.
import { buildDetail, indexDataset, repriceSnapshot, toRow, type WebDataset } from "@/core/dataset";
import type { StockDetail, StocksPayload } from "@/core/types";

const QUOTES_URL = "https://brapi.dev/api/quote/list?type=stock&limit=2000";
const STORE_KEY = "graham:quotes:v1";
const SOURCE = "Fundamentus (indicadores) · brapi (cotações ao vivo) · CVM e B3 (histórico)";

interface LiveQuotes {
  at: string;
  prices: Record<string, number>;
}

function readDataset(): WebDataset {
  const el = document.getElementById("dataset");
  if (!el?.textContent) throw new Error("Base de dados não encontrada no arquivo.");
  return JSON.parse(el.textContent) as WebDataset;
}

const ds = readDataset();
const tickerData = indexDataset(ds);

function loadLive(): LiveQuotes | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const q = JSON.parse(raw) as LiveQuotes;
    // cotações salvas mais antigas que a base embutida não valem
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

export function getStocks(): StocksPayload & { live: boolean; baseAt: string } {
  payload ??= build();
  return { ...payload, live: !!live, baseAt: ds.quotesAt };
}

/** Busca cotações atuais e recalcula os indicadores que dependem do preço. */
export async function refreshQuotes(): Promise<ReturnType<typeof getStocks> & { updated: number }> {
  let res: Response;
  try {
    res = await fetch(QUOTES_URL, { cache: "no-store" });
  } catch {
    const base = new Date(ds.quotesAt).toLocaleDateString("pt-BR");
    throw new Error(
      `as cotações ao vivo (brapi.dev) não responderam. Isso acontece sem internet ou quando a página está aberta dentro do claude.ai, que bloqueia acesso a outros sites. Os dados exibidos são de ${base}.`,
    );
  }
  if (res.status === 429) throw new Error("limite de consultas da brapi atingido. Tente de novo em 1 minuto.");
  if (!res.ok) throw new Error(`o serviço de cotações respondeu ${res.status}.`);
  const body = (await res.json()) as { stocks?: { stock: string; close: number | null }[] };
  const known = new Set(ds.snapshots.map((s) => s.ticker));
  const prices: Record<string, number> = {};
  for (const q of body.stocks ?? []) if (known.has(q.stock) && typeof q.close === "number" && q.close > 0) prices[q.stock] = q.close;
  const updated = Object.keys(prices).length;
  if (!updated) throw new Error("o serviço de cotações não devolveu preços.");
  live = { at: new Date().toISOString(), prices };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(live));
  } catch {
    // sem armazenamento: vale só nesta visita
  }
  payload = build();
  return { ...getStocks(), updated };
}

export function getDetail(ticker: string): StockDetail | null {
  const row = getStocks().stocks.find((s) => s.ticker === ticker);
  if (!row) return null;
  const detail = buildDetail(row, ds.extras[ticker] ?? null, tickerData(ticker));
  // a cotação ao vivo vale para o cabeçalho; demais campos são da coleta
  return { ...detail, updatedAt: ds.quotesAt };
}
