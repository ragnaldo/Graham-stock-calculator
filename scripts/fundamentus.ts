// Provedor de cotações e fundamentos atuais: fundamentus.com.br (leitura das páginas públicas).
// Para trocar de fonte, implemente as mesmas três funções em outro módulo.
import type { Snapshot } from "../src/core/types";

const BASE = "https://www.fundamentus.com.br";
export const HEADERS = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "pt-BR,pt;q=0.9",
};

async function getHtml(pathname: string): Promise<string> {
  const res = await fetch(`${BASE}/${pathname}`, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fundamentus respondeu ${res.status} em ${pathname}`);
  return new TextDecoder("iso-8859-1").decode(await res.arrayBuffer());
}

const strip = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** "1.234,56" -> 1234.56; "8,0%" -> 0.08; vazio/"-" -> null. */
export function parseBR(text: string): number | null {
  const t = text.trim();
  if (!t || t === "-") return null;
  const pct = t.endsWith("%");
  const v = Number(t.replace(/%/g, "").replace(/\./g, "").replace(",", ".").trim());
  if (!Number.isFinite(v)) return null;
  return pct ? v / 100 : v;
}

const key = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// cabeçalho normalizado da tabela -> campo do snapshot
const COLUMNS: Record<string, keyof Snapshot> = {
  cotacao: "price",
  pl: "pl",
  pvp: "pvp",
  psr: "psr",
  divyield: "dy",
  pativo: "pAtivo",
  pcapgiro: "pCapGiro",
  pebit: "pEbit",
  pativcircliq: "pAcl",
  evebit: "evEbit",
  evebitda: "evEbitda",
  mrgbruta: "mrgBruta",
  mrgebit: "mrgEbit",
  mrgliq: "mrgLiq",
  liqcorr: "liqCorr",
  roic: "roic",
  roe: "roe",
  liq2meses: "liq2m",
  patrimliq: "patrimLiq",
  divbrutpatrim: "divPatrim",
  divliqpatrim: "divPatrim",
  crescrec5a: "cresRec5a",
};
// múltiplos que o site zera quando não há dado
const ZERO_IS_NULL: (keyof Snapshot)[] = ["pl", "pvp", "psr", "pAtivo", "pCapGiro", "pEbit", "pAcl", "evEbit", "evEbitda", "liqCorr"];

export function parseList(html: string): Snapshot[] {
  const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => key(strip(m[1])));
  const body = html.slice(html.indexOf("<tbody"));
  const out: Snapshot[] = [];
  for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (cells.length < headers.length || !/^[A-Z0-9]{4}\d{1,2}$/.test(cells[0])) continue;
    const s = { ticker: cells[0] } as Record<string, unknown>;
    headers.forEach((h, i) => {
      const field = COLUMNS[h];
      if (field) s[field] = parseBR(cells[i]);
    });
    const snap = s as unknown as Snapshot;
    if (!(snap.price > 0)) continue;
    for (const f of ZERO_IS_NULL) if (snap[f] === 0) (snap[f] as number | null) = null;
    out.push(snap);
  }
  if (out.length < 50) throw new Error("Tabela do Fundamentus veio vazia ou em formato inesperado");
  return out;
}

export async function fetchList(): Promise<Snapshot[]> {
  return parseList(await getHtml("resultado.php"));
}

export interface Details {
  /** rótulo normalizado -> texto; rótulos repetidos (12m / 3m) ganham sufixo "#2". */
  fields: Map<string, string>;
  labels: Map<string, string>;
}

export function parseDetails(html: string): Details {
  const fields = new Map<string, string>();
  const labels = new Map<string, string>();
  const re = /<td[^>]*class="label[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="data[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
  for (const m of html.matchAll(re)) {
    const label = strip(m[1]).replace(/^\?\s*/, "");
    if (!label) continue;
    let k = key(label);
    if (fields.has(k)) k = `${k}#2`;
    if (fields.has(k)) continue;
    fields.set(k, strip(m[2]));
    labels.set(k, label);
  }
  return { fields, labels };
}

export async function fetchDetails(ticker: string): Promise<Details> {
  const d = parseDetails(await getHtml(`detalhes.php?papel=${encodeURIComponent(ticker)}`));
  if (!d.fields.has("papel")) throw new Error(`Papel ${ticker} não encontrado no Fundamentus`);
  return d;
}

export interface RawDividend {
  date: string; // YYYY-MM-DD (data com)
  type: string;
  value: number; // por ação, como pago na época
  payDate: string | null;
}

const isoDate = (br: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(br);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export function parseDividends(html: string): RawDividend[] {
  const i = html.indexOf('id="resultado"');
  if (i < 0) return [];
  const body = html.slice(i);
  const out: RawDividend[] = [];
  for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (c.length < 5) continue;
    const date = isoDate(c[0]);
    const value = parseBR(c[1]);
    const per = parseBR(c[4]) || 1;
    if (!date || value === null) continue;
    out.push({ date, type: c[2], value: value / per, payDate: isoDate(c[3]) });
  }
  return out;
}

export async function fetchDividends(ticker: string): Promise<RawDividend[]> {
  return parseDividends(await getHtml(`proventos.php?papel=${encodeURIComponent(ticker)}&tipo=2`));
}
