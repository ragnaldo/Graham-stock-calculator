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
import type { Governance } from "../src/core/dataset";

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
  cfo?: number; // fluxo de caixa operacional
  cfi?: number; // fluxo de caixa de investimento
}
export interface CompanyInfo {
  cnpj: string;
  name: string;
  sector: string;
  financial: boolean;
  tickers: Record<string, { kind: "ON" | "PN" | "UNIT"; unitShares?: number | null; inferred?: boolean }>;
  gov?: Governance;
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

/** Lê uma linha de demonstração (BPA, BPP, DRE ou DFC) para os campos que usamos. Valores em R$ mil. */
function applyAccount(stmt: string, col: (name: string) => string, r: Raw) {
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
      if (code === "6.01" && ds.startsWith("caixa liquido")) r.v.cfo = val;
      else if (code === "6.02" && ds.startsWith("caixa liquido")) r.v.cfi = val;
      if (
        code.startsWith("6.03.") &&
        val < 0 &&
        /dividend|juros s(obre|\/|\.)? ?(o )?capital|jcp|jscp|proventos/.test(ds) &&
        !/nao controlador|nao-controlador|minorit|recebid|a pagar/.test(ds)
      )
        r.divs.push([code, -val]);
    }
}

/** Campos de resultado (DRE e DFC) de um bloco já lido. */
function flowsOf(r: Raw, isCon: boolean) {
  const v = r.v;
  // evita dupla contagem pai/filho nas linhas de dividendos
  const leaf = r.divs.filter(([c]) => !r.divs.some(([o]) => o !== c && o.startsWith(c + ".")));
  return {
    rev: v.rev,
    ebit: v.ebit,
    // algumas empresas preenchem com zero a linha dos controladores: vale o lucro total
    ni: isCon && v.niCtrl !== undefined && (v.niCtrl !== 0 || !v.niTotal) ? v.niCtrl : v.niTotal,
    niTotal: v.niTotal,
    div: leaf.reduce((s, [, x]) => s + x, 0),
    /** Fluxo de caixa operacional e de investimento (R$ mil). */
    cfo: v.cfo,
    cfi: v.cfi,
  };
}

/** Campos de balanço (BPA e BPP) de um bloco já lido. */
function balanceOf(r: Raw, isCon: boolean) {
  const v = r.v;
  return {
    eq: v.eqTotal !== undefined ? v.eqTotal - (isCon ? (v.minority ?? 0) : 0) : undefined,
    assets: v.assets,
    ca: v.ca,
    cl: v.cl,
    ncl: v.ncl,
    debtS: v.debtS,
    debtL: v.debtL,
    cash: v.cash,
  };
}

/** Remove campos vazios e arredonda valores em R$ mil. */
function clean<T extends object>(row: T): T {
  const o = row as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const x = o[k];
    if (x === undefined || (typeof x === "number" && !Number.isFinite(x))) delete o[k];
    else if (typeof x === "number" && !["y", "sh", "shTreas"].includes(k)) o[k] = Math.round(x);
  }
  return row;
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
    applyAccount(stmt, col, r);
  });

  await eachZipLine(zipPath, (n) => /_(BPA|BPP|DRE|DFC_M[DI])_(con|ind)_|composicao_capital/.test(n), reader);

  const cnpjs = new Set([...raw.con.keys(), ...raw.ind.keys()]);
  for (const cnpj of cnpjs) {
    const con = raw.con.get(cnpj);
    const ind = raw.ind.get(cnpj);
    // consolidado só vale se trouxer o resultado; senão usa o individual
    const r = con && con.v.niTotal !== undefined && con.v.eqTotal !== undefined ? con : (ind ?? con)!;
    const isCon = r === con;
    const row: AnnualRow = { y: Number(r.dt.slice(0, 4)), con: isCon, ...flowsOf(r, isCon), ...balanceOf(r, isCon) };
    const s = shares.get(cnpj);
    if (s && s.dt === r.dt && s.sh > 0) {
      row.sh = s.sh;
      row.shTreas = s.treas;
    }
    clean(row);
    if (row.y !== year && row.y !== year - 1) continue; // exercício fora do arquivo
    const list = (out[cnpj] ??= []);
    const i = list.findIndex((a) => a.y === row.y);
    if (i >= 0) list[i] = { ...row, sh: row.sh ?? list[i].sh, shTreas: row.shTreas ?? list[i].shTreas };
    else list.push(row);
  }
}

// ---------- ITR: trimestres ----------
/** Trimestre: resultado dos 3 meses, balanço no fim do trimestre. Valores em R$ mil. */
export interface QuarterRow {
  d: string; // fim do trimestre, YYYY-MM-DD
  con: boolean;
  rev?: number;
  ebit?: number;
  ni?: number;
  div?: number;
  eq?: number;
  assets?: number;
  ca?: number;
  cl?: number;
  ncl?: number;
  debtS?: number;
  debtL?: number;
  cash?: number;
  sh?: number;
  shTreas?: number;
}
type Flows = ReturnType<typeof flowsOf>;
interface QuarterRaw {
  row: QuarterRow;
  ytd: Flows;
}

const monthsBetween = (ini: string, fim: string) =>
  (Number(fim.slice(0, 4)) - Number(ini.slice(0, 4))) * 12 + Number(fim.slice(5, 7)) - Number(ini.slice(5, 7)) + 1;

async function parseItr(zipPath: string, out: Map<string, Map<string, QuarterRaw>>) {
  // por escopo, empresa e trimestre: balanço, resultado do trimestre e acumulado no ano
  type Blocks = { version: number; bal: Raw; q: Raw; ytd: Raw };
  const raw: Record<Scope, Map<string, Blocks>> = { con: new Map(), ind: new Map() };
  const shares = new Map<string, { version: number; sh: number; treas: number }>();
  const blank = (): Raw => ({ version: 0, dt: "", v: {}, divs: [] });

  const reader = csvReader((entry, col) => {
    const cnpj = col("CNPJ_CIA");
    const dt = col("DT_REFER");
    const version = num(col("VERSAO"));
    if (entry.includes("composicao_capital")) {
      const key = `${cnpj}|${dt}`;
      const cur = shares.get(key);
      if (!cur || version >= cur.version)
        shares.set(key, { version, sh: num(col("QT_ACAO_TOTAL_CAP_INTEGR")), treas: num(col("QT_ACAO_TOTAL_TESOURO")) || 0 });
      return;
    }
    if (col("ORDEM_EXERC") !== "ÚLTIMO") return;
    const m = /_(BPA|BPP|DRE|DFC_M[DI])_(con|ind)_/.exec(entry);
    if (!m) return;
    const stmt = m[1].slice(0, 3);
    const map = raw[m[2] as Scope];
    const key = `${cnpj}|${dt}`;
    let b = map.get(key);
    if (!b || version > b.version) map.set(key, (b = { version, bal: blank(), q: blank(), ytd: blank() }));
    else if (version < b.version) return;

    if (stmt === "BPA" || stmt === "BPP") {
      if (col("DT_FIM_EXERC") === dt) applyAccount(stmt, col, b.bal);
      return;
    }
    const ini = col("DT_INI_EXERC");
    const fim = col("DT_FIM_EXERC");
    if (fim !== dt) return;
    const months = monthsBetween(ini, fim);
    if (ini.endsWith("-01-01")) applyAccount(stmt, col, b.ytd); // acumulado no ano
    if (months === 3 && stmt === "DRE") applyAccount(stmt, col, b.q); // só os 3 meses
  });
  await eachZipLine(zipPath, (n) => /_(BPA|BPP|DRE|DFC_M[DI])_(con|ind)_|composicao_capital/.test(n), reader);

  const keys = new Set([...raw.con.keys(), ...raw.ind.keys()]);
  for (const key of keys) {
    const [cnpj, d] = key.split("|");
    const con = raw.con.get(key);
    const ind = raw.ind.get(key);
    const ok = (b?: Blocks) => b && b.ytd.v.niTotal !== undefined && b.bal.v.eqTotal !== undefined;
    const b = ok(con) ? con! : ok(ind) ? ind! : null;
    if (!b) continue;
    const isCon = b === con;
    // no 1º trimestre o acumulado é o próprio trimestre
    const q = d.slice(5, 7) === "03" ? b.ytd : b.q;
    const qf = flowsOf(q, isCon);
    const row: QuarterRow = { d, con: isCon, rev: qf.rev, ebit: qf.ebit, ni: qf.ni, ...balanceOf(b.bal, isCon) };
    const sh = shares.get(key);
    if (sh && sh.sh > 0) {
      row.sh = sh.sh;
      row.shTreas = sh.treas;
    }
    const list = out.get(cnpj) ?? out.set(cnpj, new Map()).get(cnpj)!;
    list.set(d, { row, ytd: flowsOf(b.ytd, isCon) });
  }
}

/**
 * Fecha a série trimestral: dividendos do trimestre (DFC só traz o acumulado) e o 4º trimestre,
 * que não tem ITR: exercício anual (DFP) menos o acumulado até setembro.
 */
function finishQuarters(itr: Map<string, Map<string, QuarterRaw>>, annual: Record<string, AnnualRow[]>): Record<string, QuarterRow[]> {
  const out: Record<string, QuarterRow[]> = {};
  for (const [cnpj, byDate] of itr) {
    const years = new Set([...byDate.keys()].map((d) => Number(d.slice(0, 4))));
    for (const y of years) {
      const q3 = byDate.get(`${y}-09-30`);
      const a = annual[cnpj]?.find((r) => r.y === y);
      if (!q3 || !a || a.con !== q3.row.con || byDate.has(`${y}-12-31`)) continue;
      const minus = (x?: number, z?: number) => (x !== undefined && z !== undefined ? x - z : undefined);
      byDate.set(`${y}-12-31`, {
        row: {
          d: `${y}-12-31`,
          con: a.con,
          rev: minus(a.rev, q3.ytd.rev),
          ebit: minus(a.ebit, q3.ytd.ebit),
          ni: minus(a.ni, q3.ytd.ni),
          eq: a.eq,
          assets: a.assets,
          ca: a.ca,
          cl: a.cl,
          ncl: a.ncl,
          debtS: a.debtS,
          debtL: a.debtL,
          cash: a.cash,
          sh: a.sh,
          shTreas: a.shTreas,
        },
        ytd: { rev: a.rev, ebit: a.ebit, ni: a.ni, niTotal: a.niTotal, div: a.div ?? 0 } as Flows,
      });
    }
    const dates = [...byDate.keys()].sort();
    const rows: QuarterRow[] = [];
    for (const d of dates) {
      const cur = byDate.get(d)!;
      const prevD = dates[dates.indexOf(d) - 1];
      const prev = prevD && prevD.slice(0, 4) === d.slice(0, 4) ? byDate.get(prevD) : undefined;
      const div = d.slice(5, 7) === "03" ? cur.ytd.div : prev && prev.row.con === cur.row.con ? cur.ytd.div - prev.ytd.div : undefined;
      rows.push(clean({ ...cur.row, div: div !== undefined && div >= 0 ? div : undefined }));
    }
    out[cnpj] = rows;
  }
  return out;
}

// ---------- FRE: acionistas; índices de documentos ----------
/** Maiores acionistas diretos (formulário de referência mais recente). Pessoas físicas aparecem agregadas. */
async function parseHolders(zipPath: string, out: Map<string, { version: number; date: string; rows: { name: string; pf: boolean; pct: number; controller: boolean }[] }>) {
  const reader = csvReader((_e, col) => {
    if (col("ID_Acionista_Relacionado")) return; // só acionistas diretos da companhia
    const cnpj = col("CNPJ_Companhia");
    const version = num(col("Versao"));
    const date = col("Data_Referencia");
    let cur = out.get(cnpj);
    if (!cur || date > cur.date || (date === cur.date && version > cur.version)) out.set(cnpj, (cur = { version, date, rows: [] }));
    if (cur.date !== date || cur.version !== version) return;
    const pct = num(col("Percentual_Total_Acoes_Circulacao"));
    if (!Number.isFinite(pct)) return;
    cur.rows.push({ name: col("Acionista").trim(), pf: col("Tipo_Pessoa_Acionista") === "PF", pct, controller: col("Acionista_Controlador") === "S" });
  });
  await eachZipLine(zipPath, (n) => /fre_cia_aberta_posicao_acionaria_\d{4}\.csv$/.test(n), reader);
}

function holdersSummary(rows: { name: string; pf: boolean; pct: number; controller: boolean }[], date: string): Governance["holders"] {
  const isTreasury = (n: string) => /tesouraria/i.test(n);
  const isOthers = (n: string) => /^outros$/i.test(n.trim());
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((s, r) => s + r.pct, 0);
  const controlPct = sum((r) => r.controller && !isTreasury(r.name));
  const treasuryPct = sum((r) => isTreasury(r.name));
  const top = rows
    .filter((r) => !isTreasury(r.name) && !isOthers(r.name) && r.pct >= 1)
    .map((r) => ({ name: r.pf ? "Pessoa física" : r.name, pct: r.pct, controller: r.controller }));
  // pessoas físicas agregadas por papel (controladora ou não)
  const merged: typeof top = [];
  for (const r of top) {
    const same = r.name === "Pessoa física" ? merged.find((m) => m.name === r.name && m.controller === r.controller) : undefined;
    if (same) same.pct += r.pct;
    else merged.push({ ...r });
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    controlPct: rows.some((r) => r.controller) ? round(controlPct) : null,
    treasuryPct: round(treasuryPct),
    freeFloatPct: rows.length ? round(Math.max(0, 100 - controlPct - treasuryPct)) : null,
    top: merged.sort((a, b) => b.pct - a.pct).slice(0, 6).map((r) => ({ ...r, pct: round(r.pct) })),
    date,
  };
}

/** Último documento DFP/ITR entregue por empresa, com o link de download na CVM. */
async function parseDocIndex(zipPath: string, kind: "DFP" | "ITR", out: Map<string, { kind: "DFP" | "ITR"; date: string; link: string }[]>) {
  const best = new Map<string, { version: number; date: string; link: string }>();
  const reader = csvReader((_e, col) => {
    const cnpj = col("CNPJ_CIA");
    const version = num(col("VERSAO"));
    const date = col("DT_REFER");
    const cur = best.get(cnpj);
    if (!cur || date > cur.date || (date === cur.date && version > cur.version)) best.set(cnpj, { version, date, link: col("LINK_DOC") });
  });
  await eachZipLine(zipPath, (n) => new RegExp(`^${kind.toLowerCase()}_cia_aberta_\\d{4}\\.csv$`).test(n), reader);
  for (const [cnpj, d] of best) {
    const list = out.get(cnpj) ?? out.set(cnpj, []).get(cnpj)!;
    const i = list.findIndex((x) => x.kind === kind);
    if (i < 0) list.push({ kind, date: d.date, link: d.link });
    else if (d.date > list[i].date) list[i] = { kind, date: d.date, link: d.link };
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
  const general = new Map<string, { version: number; name: string; sector: string; control: string; status: string; site: string; about: string }>();
  const segments = new Map<string, string>();
  const auditors = new Map<string, { version: number; list: { name: string; start: string; end: string }[] }>();
  const securities = new Map<string, { version: number; rows: { kind: string; ticker: string; comp: string }[] }>();
  const reader = csvReader((entry, col) => {
    const cnpj = col("CNPJ_Companhia");
    const version = num(col("Versao"));
    if (/fca_cia_aberta_geral_/.test(entry)) {
      const cur = general.get(cnpj);
      if (!cur || version >= cur.version)
        general.set(cnpj, {
          version,
          name: col("Nome_Empresarial"),
          sector: col("Setor_Atividade"),
          control: col("Especie_Controle_Acionario"),
          status: col("Situacao_Emissor"),
          site: col("Pagina_Web"),
          about: col("Descricao_Atividade"),
        });
    } else if (/fca_cia_aberta_auditor_/.test(entry)) {
      let cur = auditors.get(cnpj);
      if (!cur || version > cur.version) auditors.set(cnpj, (cur = { version, list: [] }));
      if (version === cur.version) cur.list.push({ name: col("Auditor"), start: col("Data_Inicio_Atuacao_Auditor"), end: col("Data_Fim_Atuacao_Auditor") });
    } else {
      if (col("Mercado") === "Bolsa" && col("Segmento") && /^(Ações|Units)/.test(col("Valor_Mobiliario"))) segments.set(cnpj, col("Segmento"));
      const ticker = col("Codigo_Negociacao").trim().toUpperCase();
      const kind = col("Valor_Mobiliario");
      if (!/^[A-Z0-9]{4}\d{1,2}$/.test(ticker)) return;
      if (!/^(Ações Ordinárias|Ações Preferenciais|Units)$/.test(kind)) return;
      let cur = securities.get(cnpj);
      if (!cur || version > cur.version) securities.set(cnpj, (cur = { version, rows: [] }));
      if (version === cur.version) cur.rows.push({ kind, ticker, comp: col("Composicao_BDR_Unit") });
    }
  });
  await eachZipLine(zipPath, (n) => /fca_cia_aberta_(geral|valor_mobiliario|auditor)_/.test(n), reader);

  const govOf = (cnpj: string): Governance => {
    const g = general.get(cnpj)!;
    const current = auditors.get(cnpj)?.list.filter((a) => !a.end).sort((a, b) => b.start.localeCompare(a.start))[0];
    const site = g.site.trim();
    return {
      segment: segments.get(cnpj) || undefined,
      control: g.control || undefined,
      status: g.status || undefined,
      site: site ? (/^https?:\/\//i.test(site) ? site : `https://${site.replace(/^\/+/, "")}`) : undefined,
      about: g.about ? g.about.replace(/\s+/g, " ").trim().slice(0, 700) : undefined,
      auditor: current?.name || undefined,
      auditorSince: current?.start || undefined,
    };
  };

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
      gov: govOf(cnpj),
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
      gov: govOf(o.cnpj),
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
  const docs = new Map<string, { kind: "DFP" | "ITR"; date: string; link: string }[]>();
  const holders = new Map<string, { version: number; date: string; rows: { name: string; pf: boolean; pct: number; controller: boolean }[] }>();

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
    if (dfp && y >= lastYear - 1) await parseDocIndex(dfp, "DFP", docs);
    if (fre && y >= lastYear - 1) await parseHolders(fre, holders);
    log(`  ${y}: DFP ${dfp ? "ok" : "ausente"}, FRE ${fre ? "ok" : "ausente"}`);
  }
  deriveSplits(capital, eventsAll);

  // trimestres dos dois últimos anos (ITR); o 4º trimestre sai do anual
  const itr = new Map<string, Map<string, QuarterRaw>>();
  for (const y of [lastYear - 1, lastYear]) {
    const zip = await download(`${CVM}/ITR/DADOS/itr_cia_aberta_${y}.zip`, `itr_${y}.zip`, true);
    if (zip) await parseItr(zip, itr);
    if (zip) await parseDocIndex(zip, "ITR", docs);
    log(`  ITR ${y}: ${zip ? "ok" : "ausente"}`);
  }

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
  const quarters = finishQuarters(itr, annual);
  // nº de ações informado em milhares por algumas empresas: compara com o anual já corrigido
  for (const [cnpj, rows] of Object.entries(quarters)) {
    const ref = [...(annual[cnpj] ?? [])].reverse().find((r) => r.sh)?.sh;
    if (!ref) continue;
    for (const q of rows) {
      if (q.sh && ref / q.sh > 300 && ref / q.sh < 3000) {
        q.sh *= 1000;
        if (q.shTreas) q.shTreas *= 1000;
      }
    }
  }
  writeJson("quarters.json", Object.fromEntries(Object.entries(quarters).filter(([c]) => listed.has(c))));
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

  // governança: acionistas e documentos mais recentes
  for (const c of Object.values(companies)) {
    const h = holders.get(c.cnpj);
    c.gov = {
      ...c.gov,
      ...(h?.rows.length ? { holders: holdersSummary(h.rows, h.date) } : {}),
      ...(docs.get(c.cnpj)?.length ? { docs: docs.get(c.cnpj) } : {}),
    };
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
