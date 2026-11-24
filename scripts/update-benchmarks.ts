/**
 * Séries diárias de referência para comparar a carteira -> data/benchmarks.json
 *  - CDI: taxa diária do Banco Central (SGS, série 12), acumulada em um índice
 *  - Ibovespa: fechamento diário publicado pela B3
 *
 * Uso: npm run data:benchmarks
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Benchmarks } from "../src/core/portfolio";

const ROOT = path.resolve(__dirname, "..");
const FIRST_YEAR = 2010;
const UA = "graham-stock-calculator/0.1 (benchmarks)";

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const iso = (br: string) => `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}`;
const br = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** CDI: o Banco Central limita cada consulta a 10 anos. */
async function cdi(): Promise<[string, number][]> {
  const now = new Date();
  const rows: { data: string; valor: string }[] = [];
  for (let start = FIRST_YEAR; start <= now.getFullYear(); start += 10) {
    const end = Math.min(start + 9, now.getFullYear());
    const to = end === now.getFullYear() ? br(now) : `31/12/${end}`;
    rows.push(...(await getJson<typeof rows>(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=01/01/${start}&dataFinal=${to}`)));
  }
  // índice acumulado ao fim de cada dia: a taxa do dia D rende de D para D+1
  let idx = 1;
  const out: [string, number][] = [];
  for (const r of rows.sort((a, b) => iso(a.data).localeCompare(iso(b.data)))) {
    const v = Number(r.valor);
    if (!Number.isFinite(v)) continue;
    idx *= 1 + v / 100;
    out.push([iso(r.data), Number(idx.toPrecision(10))]);
  }
  return out;
}

interface B3Year {
  results: ({ day: number } & Record<string, string | number | null>)[];
}

async function ibov(): Promise<[string, number][]> {
  const out: [string, number][] = [];
  for (let y = FIRST_YEAR; y <= new Date().getFullYear(); y++) {
    const q = Buffer.from(JSON.stringify({ index: "IBOV", language: "pt-br", year: String(y) })).toString("base64");
    const data = await getJson<B3Year>(`https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/${q}`);
    for (const row of data.results ?? []) {
      for (let m = 1; m <= 12; m++) {
        const raw = row[`rateValue${m}`];
        if (typeof raw !== "string" || !raw) continue;
        const v = Number(raw.replace(/\./g, "").replace(",", "."));
        if (v > 0) out.push([`${y}-${String(m).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`, v]);
      }
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

async function main() {
  const [c, i] = await Promise.all([cdi(), ibov()]);
  if (c.length < 1000 || i.length < 1000) throw new Error(`séries curtas demais (CDI ${c.length}, Ibovespa ${i.length})`);
  const data: Benchmarks = { updatedAt: new Date().toISOString(), cdi: c, ibov: i };
  mkdirSync(path.join(ROOT, "data"), { recursive: true });
  writeFileSync(path.join(ROOT, "data", "benchmarks.json"), JSON.stringify(data));
  console.log(`CDI: ${c.length} dias até ${c.at(-1)![0]} · Ibovespa: ${i.length} dias até ${i.at(-1)![0]} (${i.at(-1)![1]})`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
