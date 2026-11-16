// Cache em memória + disco (.cache/api). O botão "Atualizar" força a recarga.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

interface Entry<T> {
  at: number;
  value: T;
}

const memory = new Map<string, Entry<unknown>>();
const pending = new Map<string, Promise<Entry<unknown>>>();

let dir: string | null | undefined;
function cacheDir(): string | null {
  if (dir !== undefined) return dir;
  for (const candidate of [process.env.CACHE_DIR, path.join(/*turbopackIgnore: true*/ process.cwd(), ".cache", "api"), path.join(os.tmpdir(), "graham-cache")]) {
    if (!candidate) continue;
    try {
      mkdirSync(candidate, { recursive: true });
      return (dir = candidate);
    } catch {
      // somente leitura (ex.: serverless): tenta o próximo
    }
  }
  return (dir = null);
}

const fileOf = (key: string) => {
  const d = cacheDir();
  return d ? path.join(/*turbopackIgnore: true*/ d, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`) : null;
};

function read<T>(key: string): Entry<T> | null {
  const mem = memory.get(key) as Entry<T> | undefined;
  if (mem) return mem;
  const file = fileOf(key);
  if (!file || !existsSync(file)) return null;
  try {
    const entry = JSON.parse(readFileSync(file, "utf8")) as Entry<T>;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export interface Cached<T> {
  value: T;
  at: number;
  /** true quando a fonte falhou e devolvemos o último valor salvo. */
  stale: boolean;
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<Cached<T>> {
  const hit = read<T>(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return { ...hit, stale: false };
  let job = pending.get(key) as Promise<Entry<T>> | undefined;
  if (!job) {
    job = load()
      .then((value) => {
        const entry = { at: Date.now(), value };
        memory.set(key, entry);
        const file = fileOf(key);
        if (file) {
          try {
            writeFileSync(file, JSON.stringify(entry));
          } catch {
            // disco indisponível: segue só em memória
          }
        }
        return entry;
      })
      .finally(() => pending.delete(key));
    pending.set(key, job);
  }
  try {
    return { ...(await job), stale: false };
  } catch (e) {
    if (hit) return { ...hit, stale: true };
    throw e;
  }
}

export function clearCache(prefix: string) {
  for (const k of memory.keys()) if (k.startsWith(prefix)) memory.delete(k);
  const d = cacheDir();
  if (!d) return;
  const filePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "_");
  try {
    for (const name of readdirSync(/*turbopackIgnore: true*/ d)) if (name.startsWith(filePrefix)) rmSync(path.join(/*turbopackIgnore: true*/ d, name), { force: true });
  } catch {
    // ignora
  }
}
