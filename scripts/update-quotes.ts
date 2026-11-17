/**
 * Coleta cotações e indicadores atuais no Fundamentus e grava data/snapshot.json:
 *  - tabela com todos os papéis (cotação, P/L, P/VP, DY, ROE...)
 *  - para cada papel negociado: página de detalhes (balanço, resultado) e proventos por ação
 *
 * Uso: npm run data:quotes            (≈ 3 min)
 *      npm run data:quotes -- --list-only
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FundUnit, TickerExtra } from "../src/core/dataset";
import type { Snapshot } from "../src/core/types";
import { fetchDetails, fetchDividends, fetchList, parseBR, type Details } from "./fundamentus";

const ROOT = path.resolve(__dirname, "..");
const CONCURRENCY = 6;

export interface SnapshotFile {
  quotesAt: string;
  snapshots: Snapshot[];
  extras: Record<string, TickerExtra>;
}

const FUNDAMENTALS: [key: string, label: string, unit: FundUnit][] = [
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

export function toExtra(details: Details, dividends: Awaited<ReturnType<typeof fetchDividends>> | null): TickerExtra {
  const f = (k: string) => parseBR(details.fields.get(k) ?? "");
  const text = (k: string) => details.fields.get(k) || null;
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
    f: FUNDAMENTALS.filter(([k]) => details.fields.has(k)).map(([k, label, unit]) => [label, f(k), unit]),
    d: dividends ? dividends.map((x) => [x.date, x.type, Number(x.value.toPrecision(8)), x.payDate]) : null,
  };
}

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function main() {
  const quotesAt = new Date().toISOString();
  const snapshots = await retry(fetchList);
  console.log(`lista: ${snapshots.length} papéis`);
  const extras: Record<string, TickerExtra> = {};

  if (!process.argv.includes("--list-only")) {
    const queue = snapshots.filter((s) => (s.liq2m ?? 0) > 0).map((s) => s.ticker);
    let done = 0;
    let failed = 0;
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          const details = await retry(() => fetchDetails(t));
          const dividends = await retry(() => fetchDividends(t)).catch(() => null);
          extras[t] = toExtra(details, dividends);
        } catch {
          failed++;
        }
        if (++done % 100 === 0) console.log(`  detalhes: ${done}`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`detalhes: ${Object.keys(extras).length} papéis, ${failed} falhas`);
  }

  const file: SnapshotFile = { quotesAt, snapshots, extras };
  mkdirSync(path.join(ROOT, "data"), { recursive: true });
  writeFileSync(path.join(ROOT, "data", "snapshot.json"), JSON.stringify(file));
  console.log("data/snapshot.json gravado");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
