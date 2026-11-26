// Cofre do acesso à planilha: endereço do script e chave criptografados com uma senha (AES-256-GCM,
// chave derivada com PBKDF2-SHA-256). O resultado pode ficar público no site; sem a senha não serve para nada.

export interface Vault {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export interface SheetsAccess {
  url: string;
  key: string;
}

const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function lockAccess(access: SheetsAccess, password: string, iter = ITERATIONS): Promise<Vault> {
  if (!password) throw new Error("informe uma senha");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify({ u: access.url, k: access.key }))));
  return { v: 1, kdf: "PBKDF2-SHA256", iter, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

/** Abre o cofre; senha errada rejeita com "senha incorreta". */
export async function unlockAccess(vault: Vault, password: string): Promise<SheetsAccess> {
  if (vault?.v !== 1 || vault.kdf !== "PBKDF2-SHA256") throw new Error("formato de acesso desconhecido");
  const key = await deriveKey(password, fromB64(vault.salt), vault.iter);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(vault.iv) as BufferSource }, key, fromB64(vault.ct) as BufferSource);
  } catch {
    throw new Error("senha incorreta");
  }
  const o = JSON.parse(dec.decode(plain)) as { u: string; k: string };
  return { url: o.u, key: o.k };
}

/** Confere se um texto colado é um cofre válido (para salvar no repositório). */
export function isVault(x: unknown): x is Vault {
  const v = x as Vault;
  return !!v && v.v === 1 && v.kdf === "PBKDF2-SHA256" && typeof v.iter === "number" && [v.salt, v.iv, v.ct].every((s) => typeof s === "string" && s.length > 0);
}
