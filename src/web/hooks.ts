import { useSyncExternalStore } from "react";
import { newId, type Operation } from "@/core/portfolio";
import { dataVersion, subscribeData } from "./data";
import { flush, getSheetsConfig, getSyncState, isDirty, pull, registerLocal, schedulePush, subscribeSync } from "./sync";

/** Número que muda a cada atualização de dados (Atualizar). */
export const useDataVersion = () => useSyncExternalStore(subscribeData, dataVersion, dataVersion);

// ---------- operações da carteira, guardadas neste navegador ----------
const KEY = "graham:portfolio:v1";
const listeners = new Set<() => void>();
let cache: { raw: string | null; ops: Operation[] } | null = null;
let memory: string | null = null; // quando o navegador não deixa gravar

function read(): Operation[] {
  let raw: string | null = memory;
  try {
    raw = localStorage.getItem(KEY) ?? memory;
  } catch {
    // armazenamento bloqueado
  }
  if (!cache || cache.raw !== raw) {
    let ops: Operation[] = [];
    try {
      ops = raw ? ((JSON.parse(raw) as { operations: Operation[] }).operations ?? []) : [];
    } catch {
      ops = [];
    }
    cache = { raw, ops };
  }
  return cache.ops;
}

/** Grava neste navegador e, se houver planilha conectada, nela também. */
function write(ops: Operation[]) {
  writeLocal(ops);
  if (getSheetsConfig()) schedulePush(ops);
}

function writeLocal(ops: Operation[]) {
  const raw = JSON.stringify({ version: 1, operations: ops });
  memory = raw;
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    // fica só nesta visita
  }
  cache = { raw, ops };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useOperations() {
  const ops = useSyncExternalStore(subscribe, read, () => []);
  return {
    ops,
    add: (o: Omit<Operation, "id">) => write([...read(), { ...o, id: newId() }]),
    update: (o: Operation) => write(read().map((x) => (x.id === o.id ? o : x))),
    remove: (id: string) => write(read().filter((x) => x.id !== id)),
    replace: (next: Operation[]) => write(next),
  };
}

/** Testa se o navegador guarda dados (aba anônima ou bloqueio podem impedir). */
export function storageWorks(): boolean {
  try {
    localStorage.setItem("graham:probe", "1");
    localStorage.removeItem("graham:probe");
    return true;
  } catch {
    return false;
  }
}

export const useSyncState = () => useSyncExternalStore(subscribeSync, getSyncState, getSyncState);

/** Operações atuais deste navegador. */
export const currentOperations = () => read();

/** Troca as operações locais pelas da planilha, sem reenviar. */
export const applyRemote = (ops: Operation[]) => writeLocal(ops);

let opened = false;
/**
 * Ao abrir a carteira: se houver alterações que não chegaram à planilha, envia;
 * senão, traz o que está na planilha (que pode ter sido editada lá ou em outro aparelho).
 */
export async function syncOnOpen(force = false): Promise<{ skipped: number } | null> {
  if (!getSheetsConfig() || (opened && !force)) return null;
  opened = true;
  if (isDirty()) {
    // alterações pendentes: junta com a planilha e grava (sem perder o que mudou lá)
    schedulePush(read());
    await flush();
    return { skipped: 0 };
  }
  const { ops, skipped } = await pull();
  // exemplos ficam só no navegador
  writeLocal([...ops, ...read().filter((o) => o.id.startsWith("exemplo-"))]);
  return { skipped };
}

registerLocal(read, writeLocal);
