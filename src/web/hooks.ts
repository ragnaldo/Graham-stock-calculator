import { useSyncExternalStore } from "react";
import { newId, type Operation } from "@/core/portfolio";
import { dataVersion, subscribeData } from "./data";

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

function write(ops: Operation[]) {
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
