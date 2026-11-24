/**
 * Gera o app web em um único arquivo HTML, com código, estilos e dados embutidos:
 *   dist/calculadora-graham.html   abre com dois cliques no computador ou em qualquer hospedagem
 *   dist/artifact.html             mesmo conteúdo sem <html>/<head>, para publicar no claude.ai
 *
 * Uso: npm run build
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import type { Company, PriceSeries, WebDataset } from "../src/core/dataset";
import type { AnnualRaw, QuarterRaw } from "../src/core/history";
import type { Benchmarks } from "../src/core/portfolio";
import type { SnapshotFile } from "./update-quotes";

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "dist");
const TITLE = "Calculadora Graham B3";
/** Endereço da base publicada que o botão Atualizar baixa (GitHub Pages; aceita leitura de qualquer origem). */
const DATA_URL = process.env.DATA_URL ?? "https://ragnaldo.github.io/Graham-stock-calculator/data.json";

const read = <T>(file: string): T => {
  const p = path.join(DATA, file);
  if (!existsSync(p)) throw new Error(`Falta ${path.relative(ROOT, p)}. Rode npm run data:update e npm run data:quotes.`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
};

function dataset(): WebDataset {
  const snap = read<SnapshotFile>("snapshot.json");
  const companies = read<Company[]>("companies.json");
  const annual = read<Record<string, AnnualRaw[]>>("annual.json");
  const prices = read<Record<string, PriceSeries>>("prices.json");
  const quarters = read<Record<string, QuarterRaw[]>>("quarters.json");
  const benchmarks = existsSync(path.join(DATA, "benchmarks.json")) ? read<Benchmarks>("benchmarks.json") : null;
  const meta = read<{ updatedAt?: string; lastFiscalYear?: number }>("meta.json");

  // só o que a interface usa: papéis da lista e empresas com algum desses papéis
  const listed = new Set(snap.snapshots.map((s) => s.ticker));
  const usedCompanies = companies
    .map((c) => ({ ...c, tickers: Object.fromEntries(Object.entries(c.tickers).filter(([t]) => listed.has(t))) }))
    .filter((c) => Object.keys(c.tickers).length);
  const cnpjs = new Set(usedCompanies.map((c) => c.cnpj));
  const usedPrices: Record<string, PriceSeries> = {};
  for (const [t, s] of Object.entries(prices)) {
    if (!listed.has(t)) continue;
    usedPrices[t] = { m: Object.fromEntries(Object.entries(s.m).map(([k, v]) => [k, Number(v.toPrecision(6))])), last: s.last, ...(s.splits ? { splits: s.splits } : {}) };
  }
  // trimestre mais recente com balanço publicado pela maioria das empresas
  const ends = new Map<string, number>();
  for (const rows of Object.values(quarters)) {
    const d = rows[rows.length - 1]?.d;
    if (d) ends.set(d, (ends.get(d) ?? 0) + 1);
  }
  const lastQuarter = [...ends.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    quotesAt: snap.quotesAt,
    lastQuarter,
    historyAt: meta.updatedAt ?? null,
    lastFiscalYear: meta.lastFiscalYear ?? null,
    snapshots: snap.snapshots,
    companies: usedCompanies,
    annual: Object.fromEntries(Object.entries(annual).filter(([c]) => cnpjs.has(c))),
    quarters: Object.fromEntries(Object.entries(quarters).filter(([c]) => cnpjs.has(c))),
    prices: usedPrices,
    extras: snap.extras,
    benchmarks,
  };
}

/** Evita que o conteúdo embutido feche a tag <script> antes da hora. */
const safeScript = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tmp = path.join(ROOT, ".cache", "web");
  mkdirSync(tmp, { recursive: true });

  const js = await build({
    entryPoints: [path.join(ROOT, "src/web/main.tsx")],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    jsx: "automatic",
    write: false,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"', __DATA_URL__: JSON.stringify(DATA_URL) },
    alias: { "@": path.join(ROOT, "src") },
    logLevel: "warning",
  });
  const code = js.outputFiles[0].text;

  const cssFile = path.join(tmp, "styles.css");
  execFileSync(path.join(ROOT, "node_modules/.bin/tailwindcss"), ["-i", path.join(ROOT, "src/web/styles.css"), "-o", cssFile, "--minify"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const css = readFileSync(cssFile, "utf8");

  const data = JSON.stringify(dataset());
  const body = [
    `<title>${TITLE}</title>`,
    `<meta name="description" content="Triagem de ações da B3 pelas estratégias de Benjamin Graham, com fundamentos e histórico.">`,
    `<style>${css}</style>`,
    `<div id="app"></div>`,
    `<noscript><p style="padding:16px">Ative o JavaScript para usar a calculadora.</p></noscript>`,
    `<script type="application/json" id="dataset">${safeScript(data)}</script>`,
    `<script>${safeScript(code)}</script>`,
  ].join("\n");

  const full = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body>
${body}
</body>
</html>
`;
  writeFileSync(path.join(OUT, "calculadora-graham.html"), full);
  writeFileSync(path.join(OUT, "artifact.html"), body + "\n");
  // base publicada junto com o site, lida pelo botão Atualizar
  writeFileSync(path.join(OUT, "data.json"), data);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(`dist/calculadora-graham.html  ${mb(Buffer.byteLength(full))}  (código ${mb(code.length)}, estilos ${mb(css.length)}, dados ${mb(data.length)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
