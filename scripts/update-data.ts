/**
 * Gera a base histórica em data/ a partir de fontes oficiais:
 *  - CVM Dados Abertos: DFP (balanços anuais), FRE (capital social, desdobramentos), FCA (tickers, setor)
 *  - B3 COTAHIST: cotações diárias -> fechamento mensal por ticker
 *
 * Uso:
 *   npm run data:update                 # anos faltantes + os 2 mais recentes
 *   npm run data:update -- --full       # tudo desde 2010
 *   npm run data:update -- --years 2025,2026
 *   npm run data:update -- --no-prices  # pula B3 (downloads grandes)
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import yauzl from "yauzl";

const FIRST_YEAR = 2010;
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DL_DIR = path.join(ROOT, ".cache", "downloads");
const CVM = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC";
const B3 = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist";
const UA = "graham-stock-calculator/0.1 (data ingest)";

// ---------- tipos do dataset ----------
export interface AnnualRow {
  y: number; // ano do exercício (DT_REFER)
  con: boolean; // true = consolidado
  rev?: number; // receita líquida (R$ mil)
  ebit?: number;
  ni?: number; // lucro líquido atribuído aos controladores
  niTotal?: number;
  eq?: number; // patrimônio líquido dos controladores
  assets?: number;
  ca?: number; // ativo circulante
  cl?: number; // passivo circulante
  ncl?: number; // passivo não circulante
  debtS?: number; // empréstimos CP
  debtL?: number; // empréstimos LP
  cash?: number;
  div?: number; // dividendos + JCP pagos no ano (DFC), valor positivo
  sh?: number; // ações totais (unidades)
  shTreas?: number; // ações em tesouraria
}
export interface CompanyInfo {
  cnpj: string;
  name: string;
  sector: string;
  financial: boolean;
  tickers: Record<string, { kind: "ON" | "PN" | "UNIT"; unitShares?: number | null; inferred?: boolean }>;
}
export interface SplitEvent {
  date: string; // YYYY-MM-DD (aprovação)
  factor: number; // ações depois / antes
  type: string;
  /** Eventos derivados: janela em que a mudança no nº de ações ocorreu. */
  from?: string;
  to?: string;
}

// ---------- utilidades ----------
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function readJson<T>(file: string, fallback: T): T {
  const p = path.join(DATA_DIR, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
}
function writeJson(file: string, value: unknown) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value));
}

async function download(url: string, name: string, refresh: boolean): Promise<string | null> {
  mkdirSync(DL_DIR, { recursive: true });
  const dest = path.join(DL_DIR, name);
  // --cached: reaproveita qualquer download já feito (útil para reprocessar sem rede)
  if ((!refresh || flag("cached")) && existsSync(dest) && statSync(dest).size > 0) return dest;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.status === 404) return null;
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const tmp = `${dest}.part`;
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
      renameSync(tmp, dest);
      return dest;
    } catch (e) {
      log(`  falha (${attempt}/4) ${name}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`não foi possível baixar ${url}`);
}

/** Percorre as linhas (latin1) de cada arquivo do zip aceito por `want`. */
function eachZipLine(
  zipPath: string,
  want: (entry: string) => boolean,
  onLine: (entry: string, line: string, lineNo: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!want(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2);
          stream.setEncoding("latin1");
          const rl = createInterface({ input: stream, crlfDelay: Infinity });
          let n = 0;
          rl.on("line", (line) => onLine(entry.fileName, line, n++));
          rl.on("close", () => zip.readEntry());
        });
      });
      zip.readEntry();
    });
  });
}

/** Leitor de CSV `;` da CVM: entrega objetos indexados pelo cabeçalho. */
function csvReader(onRow: (entry: string, col: (name: string) => string) => void) {
  const headers = new Map<string, Map<string, number>>();
  return (entry: string, line: string, lineNo: number) => {
    const parts = line.split(";");
    if (lineNo === 0) {
      headers.set(entry, new Map(parts.map((h, i) => [h.trim(), i])));
      return;
    }
    const h = headers.get(entry)!;
    onRow(entry, (name) => parts[h.get(name) ?? -1] ?? "");
  };
}

const num = (s: string) => (s === "" ? NaN : Number(s));
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// ---------- DFP: demonstrações anuais ----------
type Scope = "con" | "ind";
interface Raw {
  version: number;
  dt: string;
  v: Record<string, number>;
  niCode?: string;
  divs: [string, number][];
}

async function parseDfp(zipPath: string, year: number, out: Record<string, AnnualRow[]>) {
  const raw: Record<Scope, Map<string, Raw>> = { con: new Map(), ind: new Map() };
  const shares = new Map<string, { version: number; dt: string; sh: number; treas: number }>();

  const get = (scope: Scope, cnpj: string, dt: string, version: number): Raw | null => {
    const m = raw[scope];
    const cur = m.get(cnpj);
    if (!cur || dt > cur.dt || (dt === cur.dt && version > cur.version)) {
      const fresh: Raw = { version, dt, v: {}, divs: [] };
      m.set(cnpj, fresh);
      return fresh;
    }
    return dt === cur.dt && version === cur.version ? cur : null;
  };

  const reader = csvReader((entry, col) => {
    if (entry.includes("composicao_capital")) {
      const cnpj = col("CNPJ_CIA");
      const version = num(col("VERSAO"));
      const dt = col("DT_REFER");
      const cur = shares.get(cnpj);
      if (!cur || dt > cur.dt || (dt === cur.dt && version >= cur.version)) {
        shares.set(cnpj, {
          version,
          dt,
          sh: num(col("QT_ACAO_TOTAL_CAP_INTEGR")),
          treas: num(col("QT_ACAO_TOTAL_TESOURO")) || 0,
        });
      }
      return;
    }
    if (col("ORDEM_EXERC") !== "ÚLTIMO") return;
    const m = /_(BPA|BPP|DRE|DFC_M[DI])_(con|ind)_/.exec(entry);
    if (!m) return;
    const stmt = m[1].slice(0, 3);
    const scope = m[2] as Scope;
    const r = get(scope, col("CNPJ_CIA"), col("DT_REFER"), num(col("VERSAO")));
    if (!r) return;
    const code = col("CD_CONTA");
    const ds = norm(col("DS_CONTA"));
    const scale = col("ESCALA_MOEDA") === "UNIDADE" ? 0.001 : 1; // normaliza p/ R$ mil
    const val = num(col("VL_CONTA")) * scale;
    if (!Number.isFinite(val)) return;
    const depth = code.split(".").length;

    if (stmt === "BPA") {
      if (code === "1") r.v.assets = val;
      else if (code === "1.01" && ds.startsWith("ativo circulante")) r.v.ca = val;
      else if (depth === 3 && code.startsWith("1.01.") && (ds.startsWith("caixa e equivalentes") || ds.startsWith("aplicacoes financeiras")))
        r.v.cash = (r.v.cash ?? 0) + val;
    } else if (stmt === "BPP") {
      if (code === "2.01" && ds.startsWith("passivo circulante")) r.v.cl = val;
      else if (code === "2.02" && ds.startsWith("passivo nao circulante")) r.v.ncl = val;
      else if (code === "2.01.04" && ds.startsWith("emprestimos e financiamentos")) r.v.debtS = val;
      else if (code === "2.02.01" && ds.startsWith("emprestimos e financiamentos")) r.v.debtL = val;
      else if (depth === 2 && /^patrimonio liquido( consolidado)?$/.test(ds)) r.v.eqTotal = val;
      else if (depth === 3 && ds.startsWith("participacao dos acionistas nao controladores")) r.v.minority = val;
    } else if (stmt === "DRE") {
      if (code === "3.01") r.v.rev = val;
      else if (depth === 2 && ds.startsWith("resultado antes do resultado financeiro e dos tributos")) r.v.ebit = val;
      else if (depth === 2 && /^lucro(\/| ou )prejuizo (consolidado )?do periodo$/.test(ds)) {
        r.v.niTotal = val;
        r.niCode = code;
      } else if (depth === 3 && r.niCode && code.startsWith(r.niCode + ".") && ds.startsWith("atribuido a socios da empresa controladora"))
        r.v.niCtrl = val;
    } else if (stmt === "DFC") {
      if (
        code.startsWith("6.03.") &&
        val < 0 &&
        /dividend|juros s(obre|\/|\.)? ?(o )?capital|jcp|jscp|proventos/.test(ds) &&
        !/nao controlador|nao-controlador|minorit|recebid|a pagar/.test(ds)
      )
        r.divs.push([code, -val]);
    }
  });

  await eachZipLine(zipPath, (n) => /_(BPA|BPP|DRE|DFC_M[DI])_(con|ind)_|composicao_capital/.test(n), reader);

  const cnpjs = new Set([...raw.con.keys(), ...raw.ind.keys()]);
  for (const cnpj of cnpjs) {
    const con = raw.con.get(cnpj);
    const ind = raw.ind.get(cnpj);
    // consolidado só vale se trouxer o resultado; senão usa o individual
    const r = con && con.v.niTotal !== undefined && con.v.eqTotal !== undefined ? con : (ind ?? con)!;
    const isCon = r === con;
    const v = r.v;
    // evita dupla contagem pai/filho nas linhas de dividendos
    const leaf = r.divs.filter(([c]) => !r.divs.some(([o]) => o !== c && o.startsWith(c + ".")));
    const div = leaf.reduce((s, [, x]) => s + x, 0);
    const row: AnnualRow = {
      y: Number(r.dt.slice(0, 4)),
      con: isCon,
      rev: v.rev,
      ebit: v.ebit,
      ni: isCon ? (v.niCtrl ?? v.niTotal) : v.niTotal,
      niTotal: v.niTotal,
      eq: v.eqTotal !== undefined ? v.eqTotal - (isCon ? (v.minority ?? 0) : 0) : undefined,
      assets: v.assets,
      ca: v.ca,
      cl: v.cl,
      ncl: v.ncl,
      debtS: v.debtS,
      debtL: v.debtL,
      cash: v.cash,
      div: leaf.length ? div : 0,
    };
    const s = shares.get(cnpj);
    if (s && s.dt === r.dt && s.sh > 0) {
      row.sh = s.sh;
      row.shTreas = s.treas;
    }
    for (const k of Object.keys(row) as (keyof AnnualRow)[]) {
      const x = row[k];
      if (x === undefined || (typeof x === "number" && !Number.isFinite(x))) delete row[k];
      else if (typeof x === "number" && k !== "y" && k !== "sh" && k !== "shTreas") (row[k] as number) = Math.round(x);
    }
    if (row.y !== year && row.y !== year - 1) continue; // exercício fora do arquivo
    const list = (out[cnpj] ??= []);
    const i = list.findIndex((a) => a.y === row.y);
    if (i >= 0) list[i] = { ...row, sh: row.sh ?? list[i].sh, shTreas: row.shTreas ?? list[i].shTreas };
    else list.push(row);
  }
}

// ---------- FRE: capital social e desdobramentos ----------
interface CapitalPoint {
  date: string;
  capital: number;
  sh: number;
}

async function parseFre(
  zipPath: string,
  year: number,
  capital: Record<string, Record<number, CapitalPoint>>,
  splits: Record<string, SplitEvent[]>,
) {
  const best = new Map<string, { version: number; rank: number; p: CapitalPoint }>();
  const rankOf: Record<string, number> = { "Capital Integralizado": 3, "Capital Subscrito": 2, "Capital Emitido": 1 };
  const reader = csvReader((entry, col) => {
    const cnpj = col("CNPJ_Companhia");
    const version = num(col("Versao"));
    if (/capital_social_\d{4}\.csv$/.test(entry)) {
      const rank = rankOf[col("Tipo_Capital")] ?? 0;
      const sh = num(col("Quantidade_Total_Acoes"));
      if (!rank || !(sh > 0)) return;
      const p = { date: col("Data_Autorizacao_Aprovacao"), capital: num(col("Valor_Capital")), sh };
      const cur = best.get(cnpj);
      if (
        !cur ||
        version > cur.version ||
        (version === cur.version && (p.date > cur.p.date || (p.date === cur.p.date && rank > cur.rank)))
      )
        best.set(cnpj, { version, rank, p });
    } else if (/capital_social_desdobramento_\d{4}\.csv$/.test(entry)) {
      const before = num(col("Quantidade_Total_Acoes_Antes_Aprovacao"));
      const after = num(col("Quantidade_Total_Acoes_Depois_Aprovacao"));
      const date = col("Data_Aprovacao");
      if (!(before > 0) || !(after > 0) || !date) return;
      const factor = after / before;
      if (Math.abs(Math.log(factor)) < 0.01) return;
      const list = (splits[cnpj] ??= []);
      if (!list.some((e) => e.date === date && Math.abs(e.factor / factor - 1) < 0.01))
        list.push({ date, factor: Number(factor.toPrecision(8)), type: col("Tipo_Evento") });
    }
  });
  await eachZipLine(zipPath, (n) => /capital_social_\d{4}\.csv$|capital_social_desdobramento_\d{4}\.csv$/.test(n), reader);
  for (const [cnpj, { p }] of best) (capital[cnpj] ??= {})[year] = p;
}

/**
 * Desdobramentos/grupamentos fora da lista do FRE (o arquivo deixou de ser publicado em 2024):
 * o nº de ações salta ≥ 1,5× entre dois formulários sem aumento proporcional do capital social.
 * São apenas candidatos; só valem se o preço na B3 confirmar o salto (matchSplits).
 */
function deriveSplits(capital: Record<string, Record<number, CapitalPoint>>, splits: Record<string, SplitEvent[]>) {
  const snap = (f: number) => {
    const k = Math.round(f >= 1 ? f : 1 / f);
    const exact = f >= 1 ? k : 1 / k;
    return Math.abs(f / exact - 1) < 0.08 ? exact : Number(f.toPrecision(8));
  };
  for (const [cnpj, byYear] of Object.entries(capital)) {
    const list = (splits[cnpj] ??= []).filter((e) => e.type !== "Derivado");
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      const a = byYear[years[i - 1]];
      const b = byYear[years[i]];
      const ratio = b.sh / a.sh;
      if (ratio > 0.67 && ratio < 1.5) continue;
      const capRatio = a.capital > 0 ? b.capital / a.capital : 1;
      if (ratio >= 1.5 && capRatio >= 1 + (ratio - 1) * 0.5) continue; // emissão de ações, não desdobramento
      const from = `${years[i - 1]}-01-01`;
      const to = `${years[i] + 1}-04-30`;
      const factor = snap(ratio);
      const covered = list.some((e) => !e.from && e.date >= from && e.date <= to && Math.abs(Math.log(e.factor / factor)) < 0.25);
      if (!covered) list.push({ date: b.date > a.date ? b.date : `${years[i]}-01-01`, factor, type: "Derivado", from, to });
    }
    if (list.length) splits[cnpj] = list.sort((x, y) => x.date.localeCompare(y.date));
    else delete splits[cnpj];
  }
}

const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);

// ---------- FCA: empresas, setor e tickers ----------
async function parseFca(zipPath: string, companies: Record<string, CompanyInfo>) {
  const general = new Map<string, { version: number; name: string; sector: string }>();
  const securities = new Map<string, { version: number; rows: { kind: string; ticker: string; comp: string }[] }>();
  const reader = csvReader((entry, col) => {
    const cnpj = col("CNPJ_Companhia");
    const version = num(col("Versao"));
    if (/fca_cia_aberta_geral_/.test(entry)) {
      const cur = general.get(cnpj);
      if (!cur || version >= cur.version) general.set(cnpj, { version, name: col("Nome_Empresarial"), sector: col("Setor_Atividade") });
    } else {
      const ticker = col("Codigo_Negociacao").trim().toUpperCase();
      const kind = col("Valor_Mobiliario");
      if (!/^[A-Z0-9]{4}\d{1,2}$/.test(ticker)) return;
      if (!/^(Ações Ordinárias|Ações Preferenciais|Units)$/.test(kind)) return;
      let cur = securities.get(cnpj);
      if (!cur || version > cur.version) securities.set(cnpj, (cur = { version, rows: [] }));
      if (version === cur.version) cur.rows.push({ kind, ticker, comp: col("Composicao_BDR_Unit") });
    }
  });
  await eachZipLine(zipPath, (n) => /fca_cia_aberta_(geral|valor_mobiliario)_/.test(n), reader);

  for (const [cnpj, sec] of securities) {
    const g = general.get(cnpj);
    if (!g) continue;
    const sector = g.sector.replace(/^Emp\. Adm\. Part\. - /, "").trim() || "Outros";
    const c: CompanyInfo = {
      cnpj,
      name: g.name,
      sector,
      financial: FINANCIAL.test(norm(g.sector)),
      tickers: {},
    };
    for (const r of sec.rows) {
      if (r.kind === "Units") c.tickers[r.ticker] = { kind: "UNIT", unitShares: parseUnit(r.comp) };
      else c.tickers[r.ticker] = { kind: r.ticker.endsWith("3") ? "ON" : "PN" };
    }
    if (Object.keys(c.tickers).length) companies[cnpj] = c; // arquivo mais recente sobrescreve
  }

  // correções manuais do cadastro
  const overrides = JSON.parse(readFileSync(path.join(__dirname, "ticker-overrides.json"), "utf8")) as Record<string, { cnpj: string; unitShares?: number }>;
  for (const [ticker, o] of Object.entries(overrides)) {
    if (ticker.startsWith("/")) continue;
    const g = general.get(o.cnpj);
    if (!g) continue;
    const c = (companies[o.cnpj] ??= {
      cnpj: o.cnpj,
      name: g.name,
      sector: g.sector.replace(/^Emp\. Adm\. Part\. - /, "").trim() || "Outros",
      financial: FINANCIAL.test(norm(g.sector)),
      tickers: {},
    });
    c.tickers[ticker] = ticker.endsWith("11") ? { kind: "UNIT", unitShares: o.unitShares ?? null } : { kind: ticker.endsWith("3") ? "ON" : "PN" };
  }

  // classes irmãs não listadas no cadastro (ex.: só a unit): confirmadas depois pelos preços da B3
  const taken = new Set(Object.values(companies).flatMap((c) => Object.keys(c.tickers)));
  for (const c of Object.values(companies)) {
    for (const root of new Set(Object.keys(c.tickers).map((t) => t.slice(0, 4)))) {
      for (const suffix of ["3", "4"]) {
        const t = root + suffix;
        if (!taken.has(t)) c.tickers[t] = { kind: suffix === "3" ? "ON" : "PN", inferred: true };
      }
    }
  }
}

const FINANCIAL = /banco|segurador|previd|intermedia|arrendamento|credito|securitiza|bolsas? de/;

/** "1 ON e 4 PN" -> 5 ações por unit. */
export function parseUnit(text: string): number | null {
  const re = /(\d+)\s*(?:\([^)]*\)\s*)?(?:a[cç][aã]o|a[cç][oõ]es)?\s*(ordin\w*|prefer\w*|on\b|pn\w?\b|[a-z]{4}[3-8]\b)/gi;
  let total = 0;
  for (const m of text.matchAll(re)) total += Number(m[1]);
  return total > 0 && total < 100 ? total : null;
}

// ---------- B3 COTAHIST ----------
interface PriceSeries {
  m: Record<string, number>; // "YYYY-MM" -> último fechamento do mês
  last: string; // último pregão YYYYMMDD
  splits?: [string, number][]; // [data ex (YYYY-MM-DD), fator]
}
interface Jump {
  date: string;
  ratio: number;
}

async function parseCotahist(
  zipPath: string,
  wanted: Set<string>,
  prices: Record<string, PriceSeries>,
  prev: Map<string, { date: string; close: number }>,
  jumps: Map<string, Jump[]>,
) {
  const rows: [string, string, number][] = [];
  await eachZipLine(
    zipPath,
    () => true,
    (_e, line) => {
      if (line.charCodeAt(0) !== 48 || line.charCodeAt(1) !== 49) return; // "01"
      if (line.substring(10, 12) !== "02" || line.substring(24, 27) !== "010") return; // lote padrão, à vista
      const ticker = line.substring(12, 24).trimEnd();
      if (!wanted.has(ticker)) return;
      const factor = Number(line.substring(210, 217)) || 1;
      const close = Number(line.substring(108, 121)) / 100 / factor;
      if (close > 0) rows.push([line.substring(2, 10), ticker, close]);
    },
  );
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [date, ticker, close] of rows) {
    const s = (prices[ticker] ??= { m: {}, last: date });
    s.m[`${date.slice(0, 4)}-${date.slice(4, 6)}`] = Number(close.toFixed(4));
    if (date > s.last) s.last = date;
    const p = prev.get(ticker);
    if (p && p.date < date) {
      const ratio = p.close / close;
      if (Math.abs(Math.log(ratio)) > 0.07) {
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        (jumps.get(ticker) ?? jumps.set(ticker, []).get(ticker)!).push({ date: iso, ratio });
      }
    }
    if (!p || p.date <= date) prev.set(ticker, { date, close });
  }
}

/** Casa cada evento societário com um salto de preço compatível => data ex e fator. */
function matchSplits(events: SplitEvent[], tickerJumps: Jump[]): [string, number][] {
  const used = new Set<Jump>();
  const out: [string, number][] = [];
  for (const ev of events) {
    const target = Math.log(ev.factor);
    if (Math.abs(target) < 0.09) continue;
    const small = Math.abs(target) < 0.25;
    const lo = ev.from ?? addDays(ev.date, small ? -5 : -15);
    const hi = ev.to ?? addDays(ev.date, small ? 60 : 150);
    const tol = small ? Math.abs(target) * 0.3 : Math.abs(target) * 0.15;
    // janela derivada: vale o salto mais parecido; evento datado: o mais próximo da aprovação
    const cost = (j: Jump) => (ev.from ? Math.abs(Math.log(j.ratio) - target) : Math.abs(Date.parse(j.date) - Date.parse(ev.date)));
    let best: Jump | null = null;
    for (const j of tickerJumps) {
      if (used.has(j) || j.date < lo || j.date > hi) continue;
      if (Math.abs(Math.log(j.ratio) - target) > tol) continue;
      if (!best || cost(j) < cost(best)) best = j;
    }
    if (best) {
      used.add(best);
      out.push([best.date, ev.factor]);
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------- orquestração ----------
async function main() {
  const now = new Date();
  const lastYear = now.getFullYear();
  const meta = readJson<{ years: number[]; priceYears: number[]; lastFiscalYear?: number; updatedAt?: string }>("meta.json", { years: [], priceYears: [] });
  const annual = flag("full") ? {} : readJson<Record<string, AnnualRow[]>>("annual.json", {});
  const capital = flag("full") ? {} : readJson<Record<string, Record<number, CapitalPoint>>>("capital.json", {});
  const eventsAll = flag("full") ? {} : readJson<Record<string, SplitEvent[]>>("splits.json", {});
  const companies: Record<string, CompanyInfo> = {};
  const all = Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

  const pick = (done: number[]) => {
    const o = opt("years");
    if (o) return o.split(",").map(Number);
    if (flag("full")) return all;
    return all.filter((y) => !done.includes(y) || y >= lastYear - 1);
  };
  const years = pick(meta.years);
  log(`CVM: anos ${years.join(", ")}`);

  for (const y of [lastYear - 1, lastYear]) {
    const fca = await download(`${CVM}/FCA/DADOS/fca_cia_aberta_${y}.zip`, `fca_${y}.zip`, true);
    if (fca) await parseFca(fca, companies);
  }
  log(`  empresas com ticker: ${Object.keys(companies).length}`);

  for (const y of years) {
    const refresh = y >= lastYear - 1;
    const dfp = await download(`${CVM}/DFP/DADOS/dfp_cia_aberta_${y}.zip`, `dfp_${y}.zip`, refresh);
    if (dfp) await parseDfp(dfp, y, annual);
    const fre = await download(`${CVM}/FRE/DADOS/fre_cia_aberta_${y}.zip`, `fre_${y}.zip`, refresh);
    if (fre) await parseFre(fre, y, capital, eventsAll);
    log(`  ${y}: DFP ${dfp ? "ok" : "ausente"}, FRE ${fre ? "ok" : "ausente"}`);
  }
  deriveSplits(capital, eventsAll);

  // nº de ações por ano: DFP (2020+) ou capital social do FRE do ano
  for (const [cnpj, rows] of Object.entries(annual)) {
    rows.sort((a, b) => a.y - b.y);
    const cap = capital[cnpj] ?? {};
    const capYears = Object.keys(cap).map(Number).sort((x, y) => x - y);
    const timeline: { date: string; sh: number }[] = [];
    for (const y of capYears) {
      const p = cap[y];
      const same = timeline.find((t) => t.date === p.date);
      if (!same) timeline.push({ date: p.date, sh: p.sh });
      else if (Math.abs(p.sh / same.sh - 1) > 0.005) timeline.push({ date: `${y}-01-01`, sh: p.sh }); // data de aprovação não atualizada
    }
    timeline.sort((x, y) => x.date.localeCompare(y.date));
    for (const r of rows) {
      const ref = cap[r.y] ?? (capYears.length ? cap[capYears.reduce((a, b) => (Math.abs(b - r.y) < Math.abs(a - r.y) ? b : a))] : undefined);
      if (!r.sh) {
        // o FRE do ano pode já trazer o capital do início do ano seguinte: vale o último estado aprovado até 31/12
        const yearEnd = `${r.y}-12-31`;
        const at = timeline.filter((p) => p.date <= yearEnd).pop();
        const sh = at?.sh ?? cap[r.y]?.sh;
        if (sh) r.sh = sh;
        continue;
      }
      // composição do capital informada em milhares por algumas empresas
      if (ref && ref.sh / r.sh > 300 && ref.sh / r.sh < 3000) {
        r.sh *= 1000;
        if (r.shTreas) r.shTreas *= 1000;
      }
    }
  }

  // mantém só empresas com ticker em bolsa
  const listed = new Set(Object.keys(companies));
  const annualOut = Object.fromEntries(Object.entries(annual).filter(([c]) => listed.has(c)));
  const splitsOut = Object.fromEntries(Object.entries(eventsAll).filter(([c]) => listed.has(c)));

  writeJson("annual.json", annualOut);
  writeJson("capital.json", Object.fromEntries(Object.entries(capital).filter(([c]) => listed.has(c))));
  writeJson("splits.json", splitsOut);
  meta.years = [...new Set([...meta.years, ...years])].sort();
  // último exercício com cobertura ampla (alguns exercícios sociais terminam fora de dezembro)
  const latest = new Map<number, number>();
  for (const rows of Object.values(annualOut)) {
    const y = rows[rows.length - 1]?.y;
    if (y) latest.set(y, (latest.get(y) ?? 0) + 1);
  }
  meta.lastFiscalYear = [...latest.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  log(`CVM ok: ${Object.keys(annualOut).length} empresas com demonstrações`);

  if (!flag("no-prices")) {
    const wanted = new Set(Object.values(companies).flatMap((c) => Object.keys(c.tickers)));
    const priceYears = opt("years") ? years : flag("full") || !meta.priceYears.length ? all : all.filter((y) => !meta.priceYears.includes(y) || y >= lastYear - 1);
    const full = priceYears.length === all.length;
    const prices = full ? {} : readJson<Record<string, PriceSeries>>("prices.json", {});
    const prev = new Map<string, { date: string; close: number }>();
    const jumps = new Map<string, Jump[]>();
    log(`B3: anos ${priceYears.join(", ")}`);
    for (const y of priceYears) {
      const zip = await download(`${B3}/COTAHIST_A${y}.ZIP`, `cotahist_${y}.zip`, y >= lastYear - 1);
      if (!zip) continue;
      await parseCotahist(zip, wanted, prices, prev, jumps);
      log(`  ${y}: ok`);
    }
    for (const c of Object.values(companies)) {
      for (const t of Object.keys(c.tickers)) {
        const s = prices[t];
        if (!s) continue;
        const matched = matchSplits(eventsAll[c.cnpj] ?? [], jumps.get(t) ?? []);
        const firstYear = String(priceYears[0]);
        const kept = (s.splits ?? []).filter(([d]) => d < firstYear); // anos não reprocessados
        s.splits = [...kept, ...matched];
        if (!s.splits.length) delete s.splits;
      }
    }
    const cutoff = `${lastYear - 1}0101`;
    for (const [t, s] of Object.entries(prices)) if (s.last < cutoff) delete prices[t];
    writeJson("prices.json", prices);
    meta.priceYears = [...new Set([...meta.priceYears, ...priceYears])].sort();
    log(`B3 ok: ${Object.keys(prices).length} tickers`);
  }

  // classes inferidas só ficam se tiverem negociação registrada
  const traded = new Set(Object.keys(readJson<Record<string, unknown>>("prices.json", {})));
  for (const c of Object.values(companies)) {
    for (const [t, info] of Object.entries(c.tickers)) {
      if (!info.inferred) continue;
      if (traded.has(t)) delete info.inferred;
      else delete c.tickers[t];
    }
  }
  writeJson("companies.json", Object.values(companies).sort((a, b) => a.name.localeCompare(b.name)));

  meta.updatedAt = now.toISOString();
  writeJson("meta.json", meta);
  log("concluído");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
