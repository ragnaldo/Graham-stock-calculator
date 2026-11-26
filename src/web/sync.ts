// Sincronização da carteira com uma planilha do Google (script em apps-script/Codigo.gs).
// O endereço do app da Web e a chave ficam neste navegador; as operações, na planilha.
import { newId, type Operation } from "@/core/portfolio";

declare const __DATA_URL__: string;

/** Endereço público do site, base do link pessoal (funciona mesmo abrindo o arquivo baixado). */
export const SITE_URL = typeof __DATA_URL__ === "string" ? __DATA_URL__.replace(/data\.json$/, "") : "https://ragnaldo.github.io/Graham-stock-calculator/";

const CONFIG_KEY = "graham:sheets:v1";
const DIRTY_KEY = "graham:sheets:dirty";
/** Lista como estava na última sincronização bem-sucedida (base da junção). */
const BASE_KEY = "graham:sheets:base";

export interface SheetsConfig {
  url: string;
  key: string;
  /** Link para abrir a planilha, devolvido pelo script. */
  sheetUrl?: string;
  /** Versão do script na planilha (1 = sem a aba com o link pessoal). */
  scriptVersion?: number;
}

// ---------- link pessoal: endereço e chave no fragmento (#), que o navegador não envia a servidor nenhum ----------
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b + "=".repeat((4 - (b.length % 4)) % 4))));
};

/** Link que conecta qualquer navegador à planilha, sem colar endereço nem chave. */
export function personalLink(cfg: Pick<SheetsConfig, "url" | "key">, site = SITE_URL): string {
  return `${site}#conectar=${b64url(JSON.stringify({ u: cfg.url, k: cfg.key }))}`;
}

/** Lê o fragmento "conectar=..." de um link pessoal; null se não for um. */
export function parseLink(hash: string): { url: string; key: string } | null {
  const m = /(?:^|#)conectar=([A-Za-z0-9_\-=+/]+)/.exec(hash);
  if (!m) return null;
  try {
    const o = JSON.parse(unb64url(m[1])) as { u?: unknown; k?: unknown };
    if (typeof o.u !== "string" || typeof o.k !== "string" || !validUrl(o.u) || !o.k) return null;
    return { url: o.u, key: o.k };
  } catch {
    return null;
  }
}

let pendingLink: { url: string; key: string } | null = null;
/** Guardado ao abrir o site por um link pessoal; a tela da carteira conecta sozinha. */
export const setPendingLink = (l: { url: string; key: string } | null) => (pendingLink = l);
export const takePendingLink = () => {
  const l = pendingLink;
  pendingLink = null;
  return l;
};

export type SyncState =
  | { status: "off" }
  | { status: "loading" | "saving" }
  | { status: "ok"; at: string }
  | { status: "error"; message: string; at: string };

const read = <T,>(k: string): T | null => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // sem armazenamento: vale só nesta visita
  }
};

let config: SheetsConfig | null = read<SheetsConfig>(CONFIG_KEY);
let state: SyncState = config ? { status: "loading" } : { status: "off" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const set = (s: SyncState) => {
  state = s;
  emit();
};

export const getSyncState = () => state;
export const getSheetsConfig = () => config;
export function subscribeSync(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Há alterações locais que ainda não chegaram à planilha. */
export const isDirty = () => read<boolean>(DIRTY_KEY) === true;
const setDirty = (v: boolean) => write(DIRTY_KEY, v || null);

export function validUrl(url: string) {
  return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url.trim());
}

interface Reply {
  ok: boolean;
  erro?: string;
  operacoes?: unknown[];
  planilha?: string;
  versao?: number;
}

async function call(cfg: SheetsConfig, body?: unknown): Promise<Reply> {
  let res: Response;
  try {
    res = body
      ? // text/plain evita a consulta prévia de CORS, que o Google não responde
        await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" })
      : await fetch(`${cfg.url}${cfg.url.includes("?") ? "&" : "?"}chave=${encodeURIComponent(cfg.key)}&t=${Date.now()}`, { redirect: "follow" });
  } catch {
    throw new Error("sem conexão com a planilha. Verifique a internet e se o app da Web está implantado com acesso para Qualquer pessoa.");
  }
  if (!res.ok) throw new Error(`a planilha respondeu ${res.status}. Confira o endereço do app da Web.`);
  let reply: Reply;
  try {
    reply = (await res.json()) as Reply;
  } catch {
    throw new Error("a resposta não veio do script da calculadora. Confira se o endereço termina em /exec e se o acesso é Qualquer pessoa.");
  }
  if (!reply.ok) throw new Error(reply.erro ?? "erro desconhecido no script");
  return reply;
}

/** Converte as linhas da planilha, descartando as que não formam uma operação válida. */
export function fromSheet(list: unknown[]): { ops: Operation[]; skipped: number } {
  const ops: Operation[] = [];
  let skipped = 0;
  for (const raw of list) {
    const o = raw as Partial<Operation>;
    const ticker = String(o.ticker ?? "").trim().toUpperCase();
    const ok =
      /^[A-Z0-9]{4}\d{1,2}$/.test(ticker) &&
      (o.type === "C" || o.type === "V") &&
      typeof o.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.date) &&
      typeof o.qty === "number" &&
      o.qty > 0 &&
      typeof o.price === "number" &&
      o.price > 0;
    if (!ok) {
      skipped++;
      continue;
    }
    ops.push({ id: o.id ? String(o.id) : newId(), ticker, type: o.type!, date: o.date!, qty: o.qty!, price: o.price!, fees: typeof o.fees === "number" && o.fees > 0 ? o.fees : undefined });
  }
  return { ops, skipped };
}

const same = (a: Operation, b: Operation) =>
  a.ticker === b.ticker && a.type === b.type && a.date === b.date && a.qty === b.qty && a.price === b.price && (a.fees ?? 0) === (b.fees ?? 0);

/**
 * Junta as alterações feitas no navegador e na planilha desde a última sincronização (`base`).
 * Inclusões e exclusões dos dois lados valem; numa operação alterada nos dois, vale a do navegador.
 */
export function merge(base: Operation[], local: Operation[], remote: Operation[]): Operation[] {
  const b = new Map(base.map((o) => [o.id, o]));
  const l = new Map(local.map((o) => [o.id, o]));
  const r = new Map(remote.map((o) => [o.id, o]));
  const out: Operation[] = [];
  for (const id of new Set([...r.keys(), ...l.keys()])) {
    const lo = l.get(id);
    const ro = r.get(id);
    const bo = b.get(id);
    if (lo && ro) out.push(bo && same(lo, bo) ? ro : lo);
    else if (lo) {
      if (!bo) out.push(lo); // novo no navegador; se estava na base, foi excluído na planilha
    } else if (ro) {
      if (!bo || !same(ro, bo)) out.push(ro); // novo (ou alterado) na planilha; se não mudou, foi excluído no navegador
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
}

let localStore: { get: () => Operation[]; set: (ops: Operation[]) => void } | null = null;
/** O armazenamento da carteira se registra aqui para a sincronização ler e atualizar a cópia local. */
export function registerLocal(get: () => Operation[], set: (ops: Operation[]) => void) {
  localStore = { get, set };
}

const base = () => read<Operation[]>(BASE_KEY) ?? [];
const setBase = (ops: Operation[]) => write(BASE_KEY, ops);

const now = () => new Date().toISOString();

/**
 * Grava a lista. Se a confirmação não puder ser lida (o navegador às vezes bloqueia a resposta
 * redirecionada do Google), relê a planilha e confere se a gravação chegou.
 */
async function save(cfg: SheetsConfig, list: Operation[]) {
  try {
    await call(cfg, { chave: cfg.key, operacoes: list });
  } catch (e) {
    const check = await call(cfg).catch(() => null);
    const stored = check ? fromSheet(check.operacoes ?? []).ops : null;
    const key = (ops: Operation[]) =>
      ops
        .map((o) => [o.id, o.ticker, o.type, o.date, o.qty, o.price, o.fees ?? 0].join("|"))
        .sort()
        .join(";");
    if (!stored || key(stored) !== key(list)) throw e;
  }
}
const sendable = (ops: Operation[]) => ops.filter((o) => !o.id.startsWith("exemplo-"));

/** Busca as operações da planilha. */
export async function pull(): Promise<{ ops: Operation[]; skipped: number }> {
  if (!config) throw new Error("planilha não conectada");
  set({ status: "loading" });
  try {
    const reply = await call(config);
    if ((reply.planilha && reply.planilha !== config.sheetUrl) || (reply.versao ?? 1) !== config.scriptVersion) {
      config = { ...config, sheetUrl: reply.planilha ?? config.sheetUrl, scriptVersion: reply.versao ?? 1 };
      write(CONFIG_KEY, config);
    }
    const result = fromSheet(reply.operacoes ?? []);
    setBase(result.ops);
    set({ status: "ok", at: now() });
    return result;
  } catch (e) {
    set({ status: "error", message: (e as Error).message, at: now() });
    throw e;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let latest: Operation[] | null = null;

/** Grava a lista completa na planilha (com uma pequena espera para juntar alterações seguidas). */
export function schedulePush(ops: Operation[]) {
  if (!config) return;
  setDirty(true);
  latest = ops;
  if (timer) clearTimeout(timer);
  set({ status: "saving" });
  timer = setTimeout(() => void flush(), 600);
}

export async function flush(): Promise<void> {
  if (!config || !latest) return;
  timer = null;
  const cfg = config;
  set({ status: "saving" });
  try {
    // lê antes de gravar, para não apagar o que foi mudado direto na planilha
    const reply = await call(cfg);
    const remote = fromSheet(reply.operacoes ?? []).ops;
    const local = localStore?.get() ?? latest;
    const merged = merge(base(), sendable(local), remote);
    await save(cfg, merged);
    setBase(merged);
    latest = null;
    setDirty(false);
    // traz para o navegador o que veio da planilha (exemplos continuam só aqui)
    const examples = local.filter((o) => o.id.startsWith("exemplo-"));
    localStore?.set([...merged, ...examples]);
    set({ status: "ok", at: now() });
  } catch (e) {
    set({ status: "error", message: `${(e as Error).message} As alterações ficaram neste navegador e serão enviadas na próxima sincronização.`, at: now() });
  }
}

/** Substitui o conteúdo da planilha por esta lista (escolha explícita ao conectar). */
export async function pushNow(ops: Operation[]) {
  if (!config) throw new Error("planilha não conectada");
  set({ status: "saving" });
  try {
    const list = sendable(ops);
    await save(config, list);
    setBase(list);
    setDirty(false);
    latest = null;
    set({ status: "ok", at: now() });
  } catch (e) {
    set({ status: "error", message: (e as Error).message, at: now() });
    throw e;
  }
}

/** Testa a conexão e guarda a configuração. Devolve as operações que estão na planilha. */
export async function connect(cfg: SheetsConfig): Promise<{ ops: Operation[]; skipped: number; sheetUrl?: string }> {
  const clean = { url: cfg.url.trim(), key: cfg.key };
  if (!validUrl(clean.url)) throw new Error("o endereço precisa ser o do app da Web do Google, começando com https://script.google.com/");
  if (!clean.key) throw new Error("informe a chave definida no script");
  const reply = await call(clean);
  config = { ...clean, sheetUrl: reply.planilha, scriptVersion: reply.versao ?? 1 };
  write(CONFIG_KEY, config);
  const result = fromSheet(reply.operacoes ?? []);
  setBase(result.ops);
  set({ status: "ok", at: now() });
  return { ...result, sheetUrl: reply.planilha };
}

export function disconnect() {
  config = null;
  latest = null;
  if (timer) clearTimeout(timer);
  write(CONFIG_KEY, null);
  write(BASE_KEY, null);
  setDirty(false);
  set({ status: "off" });
}
