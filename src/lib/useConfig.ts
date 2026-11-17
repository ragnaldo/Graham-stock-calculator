import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_CONFIG, getStrategy, type ScreenConfig } from "@/core/strategies";

const KEY = "graham:config:v1";
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: ScreenConfig } | null = null;

function parse(raw: string | null): ScreenConfig {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const c = JSON.parse(raw) as Partial<ScreenConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...c,
      // descarta estratégias que não existem mais
      active: (c.active ?? DEFAULT_CONFIG.active).filter((a) => getStrategy(a.id)),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function snapshot(): ScreenConfig {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // armazenamento indisponível: usa o padrão
  }
  if (!cache || cache.raw !== raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** Configuração da triagem, salva no navegador e compartilhada entre as páginas. */
export function useConfig(): [ScreenConfig, (next: ScreenConfig) => void] {
  const config = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_CONFIG);
  const set = useCallback((next: ScreenConfig) => {
    const raw = JSON.stringify(next);
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      // segue só em memória
    }
    cache = { raw, value: next };
    listeners.forEach((fn) => fn());
  }, []);
  return [config, set];
}
