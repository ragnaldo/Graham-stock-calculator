// Base histórica gerada por scripts/update-data.ts (CVM + B3), lida de data/*.json.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnnualRaw, Split } from "@/core/history";

interface Company {
  cnpj: string;
  name: string;
  sector: string;
  financial: boolean;
  tickers: Record<string, { kind: "ON" | "PN" | "UNIT"; unitShares?: number | null }>;
}
interface PriceSeries {
  m: Record<string, number>;
  last: string;
  splits?: Split[];
}
interface Meta {
  years: number[];
  priceYears: number[];
  lastFiscalYear?: number;
  updatedAt?: string;
}

export interface TickerData {
  company: Company;
  kind: "ON" | "PN" | "UNIT";
  /** Ações por unit (1 para ON/PN); null quando a composição não pôde ser lida. */
  unitShares: number | null;
  annual: AnnualRaw[];
  monthly: Record<string, number>;
  splits: Split[];
}

interface Dataset {
  meta: Meta;
  byTicker: Map<string, Company>;
  annual: Record<string, AnnualRaw[]>;
  prices: Record<string, PriceSeries>;
}

let dataset: Dataset | null = null;

function load(): Dataset {
  if (dataset) return dataset;
  const dir = path.join(process.cwd(), "data");
  const read = <T>(file: string, fallback: T): T => {
    const p = path.join(dir, file);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  };
  const companies = read<Company[]>("companies.json", []);
  const byTicker = new Map<string, Company>();
  for (const c of companies) for (const t of Object.keys(c.tickers)) byTicker.set(t, c);
  dataset = {
    meta: read<Meta>("meta.json", { years: [], priceYears: [] }),
    byTicker,
    annual: read<Record<string, AnnualRaw[]>>("annual.json", {}),
    prices: read<Record<string, PriceSeries>>("prices.json", {}),
  };
  return dataset;
}

export function datasetMeta() {
  const { meta } = load();
  return { updatedAt: meta.updatedAt ?? null, lastYear: meta.lastFiscalYear ?? null };
}

export function tickerData(ticker: string): TickerData | null {
  const d = load();
  const company = d.byTicker.get(ticker);
  if (!company) return null;
  const t = company.tickers[ticker];
  const series = d.prices[ticker];
  return {
    company,
    kind: t.kind,
    unitShares: t.kind === "UNIT" ? (t.unitShares ?? null) : 1,
    annual: d.annual[company.cnpj] ?? [],
    monthly: series?.m ?? {},
    splits: series?.splits ?? [],
  };
}
