// Testa o script da planilha com uma simulação mínima dos serviços do Google.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Cell = string | number | Date;

function google(rows: Cell[][] = []) {
  const sheet: Cell[][] = rows.map((r) => [...r]);
  let exists = rows.length > 0;
  const range = (r: number, c: number, nr: number, nc: number) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sheet[r - 1 + i]?.[c - 1 + j] ?? "")),
    setValues: (v: Cell[][]) => v.forEach((row, i) => row.forEach((x, j) => ((sheet[r - 1 + i] ??= [])[c - 1 + j] = x))),
    setValue: (x: Cell) => ((sheet[r - 1] ??= [])[c - 1] = x),
    clearContent: () => {
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sheet[r - 1 + i]) sheet[r - 1 + i][c - 1 + j] = "";
    },
    setNumberFormat: () => undefined,
  });
  const tab = {
    getLastRow: () => {
      let last = 0;
      sheet.forEach((r, i) => r.some((x) => x !== "" && x !== undefined) && (last = i + 1));
      return last;
    },
    getRange: (r: number, c: number, nr = 1, nc = 1) => range(r, c, nr, nc),
    appendRow: (r: Cell[]) => sheet.push(r),
    setFrozenRows: () => undefined,
  };
  let uid = 0;
  const env = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => (exists ? tab : null), insertSheet: () => ((exists = true), tab), getUrl: () => "https://docs.google.com/spreadsheets/d/x" }),
    },
    ContentService: { createTextOutput: (s: string) => ({ setMimeType: () => s }), MimeType: { JSON: "json" } },
    LockService: { getScriptLock: () => ({ waitLock: () => undefined, releaseLock: () => undefined }) },
    Session: { getScriptTimeZone: () => "America/Sao_Paulo" },
    Utilities: {
      getUuid: () => `uuid-${++uid}`,
      formatDate: (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    },
  };
  const code = readFileSync(path.join(__dirname, "Codigo.gs"), "utf8").replace('var CHAVE = "troque-esta-chave";', 'var CHAVE = "segredo";');
  const api = new Function(...Object.keys(env), `${code}; return { doGet, doPost };`)(...Object.values(env)) as {
    doGet: (e: unknown) => string;
    doPost: (e: unknown) => string;
  };
  return {
    sheet,
    get: (chave: string) => JSON.parse(api.doGet({ parameter: { chave } })),
    post: (body: unknown) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } })),
  };
}

const ops = [
  { id: "a1", ticker: "PETR4", type: "C", date: "2025-03-10", qty: 100, price: 38.5, fees: 4.9 },
  { id: "a2", ticker: "PETR4", type: "V", date: "2026-01-15", qty: 40, price: 41 },
];

describe("script da planilha", () => {
  it("grava e lê de volta, criando a aba na primeira vez", () => {
    const g = google();
    expect(g.post({ chave: "segredo", operacoes: ops })).toEqual({ ok: true, total: 2 });
    expect(g.sheet[0]).toEqual(["id", "Data", "Papel", "Operação", "Quantidade", "Preço", "Taxas"]);
    expect(g.sheet[1][3]).toBe("Compra");
    const r = g.get("segredo");
    expect(r.ok).toBe(true);
    expect(r.operacoes).toEqual([
      { ...ops[0], fees: 4.9 },
      ops[1],
    ]);
  });

  it("recusa chave errada e chave padrão", () => {
    const g = google();
    expect(g.get("outra")).toEqual({ ok: false, erro: "chave incorreta" });
    expect(g.post({ chave: "x", operacoes: [] }).ok).toBe(false);
  });

  it("lê linhas digitadas na planilha: data dd/mm/aaaa, vírgula decimal e sem id", () => {
    const g = google([
      ["id", "Data", "Papel", "Operação", "Quantidade", "Preço", "Taxas"],
      ["", "05/02/2024", " itsa4 ", "compra", "1.000", "9,87", ""],
      ["", "", "", "", "", "", ""],
      ["", new Date(2024, 5, 3, 12), "WEGE3", "Venda", 10, 35.2, 1.5],
    ]);
    const r = g.get("segredo");
    expect(r.operacoes).toEqual([
      { id: "uuid-1", date: "2024-02-05", ticker: "ITSA4", type: "C", qty: 1000, price: 9.87 },
      { id: "uuid-2", date: "2024-06-03", ticker: "WEGE3", type: "V", qty: 10, price: 35.2, fees: 1.5 },
    ]);
    expect(g.sheet[1][0]).toBe("uuid-1"); // id gravado na planilha
  });

  it("apaga as linhas que saíram da lista", () => {
    const g = google();
    g.post({ chave: "segredo", operacoes: ops });
    g.post({ chave: "segredo", operacoes: [ops[0]] });
    expect(g.get("segredo").operacoes.map((o: { id: string }) => o.id)).toEqual(["a1"]);
  });
});
