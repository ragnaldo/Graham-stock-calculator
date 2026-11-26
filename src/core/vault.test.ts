import { describe, expect, it } from "vitest";
import { isVault, lockAccess, unlockAccess } from "./vault";

const access = { url: "https://script.google.com/macros/s/ABC/exec", key: "chave-ç-123" };

describe("cofre do acesso", () => {
  it("abre com a senha certa e não guarda nada legível", async () => {
    const v = await lockAccess(access, "segredo forte", 1000);
    expect(isVault(v)).toBe(true);
    const text = JSON.stringify(v);
    expect(text).not.toContain("script.google.com");
    expect(text).not.toContain("chave");
    expect(await unlockAccess(v, "segredo forte")).toEqual(access);
  });

  it("recusa senha errada e cofre adulterado", async () => {
    const v = await lockAccess(access, "certa", 1000);
    await expect(unlockAccess(v, "errada")).rejects.toThrow("senha incorreta");
    const bad = { ...v, ct: v.ct.slice(0, -4) + "AAAA" };
    await expect(unlockAccess(bad, "certa")).rejects.toThrow("senha incorreta");
  });

  it("cada geração usa sal e vetor novos", async () => {
    const a = await lockAccess(access, "x", 1000);
    const b = await lockAccess(access, "x", 1000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ct).not.toBe(b.ct);
  });

  it("usa 600 mil iterações por padrão", async () => {
    expect((await lockAccess(access, "x")).iter).toBe(600_000);
  });
});
