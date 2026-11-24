import { describe, expect, it } from "vitest";
import type { Operation } from "@/core/portfolio";
import { fromSheet, merge } from "./sync";

const op = (id: string, over: Partial<Operation> = {}): Operation => ({ id, ticker: "PETR4", type: "C", date: "2025-01-10", qty: 10, price: 30, ...over });

describe("junção navegador × planilha", () => {
  const base = [op("a"), op("b"), op("c")];

  it("mantém inclusões dos dois lados", () => {
    const out = merge(base, [...base, op("n1")], [...base, op("p1")]);
    expect(out.map((o) => o.id).sort()).toEqual(["a", "b", "c", "n1", "p1"]);
  });

  it("aplica exclusões dos dois lados", () => {
    const local = base.filter((o) => o.id !== "a");
    const remote = base.filter((o) => o.id !== "b");
    expect(merge(base, local, remote).map((o) => o.id)).toEqual(["c"]);
  });

  it("aceita edição feita na planilha e prefere o navegador quando os dois mudaram", () => {
    const remote = [op("a", { qty: 99 }), op("b", { price: 1 }), op("c")];
    const local = [op("a"), op("b", { price: 2 }), op("c")];
    const out = merge(base, local, remote);
    expect(out.find((o) => o.id === "a")!.qty).toBe(99);
    expect(out.find((o) => o.id === "b")!.price).toBe(2);
  });

  it("não ressuscita operação excluída no navegador se a planilha não a mudou", () => {
    expect(merge(base, [op("a"), op("b")], base).map((o) => o.id)).toEqual(["a", "b"]);
  });
});

describe("linhas da planilha", () => {
  it("descarta linhas incompletas e normaliza o código", () => {
    const r = fromSheet([op("x", { ticker: " itsa4 " }), { id: "y", ticker: "PETR4", type: "C", date: "", qty: 1, price: 1 }, { id: "z" }]);
    expect(r.ops.map((o) => o.ticker)).toEqual(["ITSA4"]);
    expect(r.skipped).toBe(2);
  });
});
