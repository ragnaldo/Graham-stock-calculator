import { describe, expect, it } from "vitest";
import type { Position } from "./portfolio";
import { DEFAULT_SETTINGS, diagnose, planRebalance, targetWeights, type AssetInfo } from "./rebalance";

const pos = (ticker: string, value: number, price = 10): Position => ({
  ticker,
  name: null,
  sector: null,
  qty: value / price,
  avgPrice: price,
  cost: value,
  price,
  value,
  gain: 0,
  gainPct: 0,
  dividends: 0,
  realized: 0,
  weight: 0,
  firstBuy: "2025-01-01",
});

const meta: Record<string, Partial<AssetInfo>> = {
  PETR3: { company: "petro", sector: "Petróleo", state: true },
  PETR4: { company: "petro", sector: "Petróleo", state: true },
  ITUB4: { company: "itau", sector: "Bancos" },
  BBAS3: { company: "bb", sector: "Bancos", state: true },
  WEGE3: { company: "weg", sector: "Máquinas" },
  TAEE11: { company: "taesa", sector: "Energia" },
  RUIM3: { company: "ruim", sector: "Varejo", alert: "prejuízo nos últimos 12 meses" },
};
const info = (t: string): AssetInfo => ({ ticker: t, company: t, sector: "Outros", price: 10, state: false, liquidity: 5e6, alert: null, ...meta[t] });

describe("diagnóstico", () => {
  it("junta classes da mesma empresa e aponta concentração", () => {
    const d = diagnose([pos("PETR3", 3000), pos("PETR4", 3000), pos("ITUB4", 2000), pos("WEGE3", 2000)], info);
    expect(d.companies[0]).toMatchObject({ company: "petro", tickers: ["PETR3", "PETR4"] });
    expect(d.companies[0].weight).toBeCloseTo(0.6);
    expect(d.effectiveAssets).toBeCloseTo(1 / (0.36 + 0.04 + 0.04));
    const byId = Object.fromEntries(d.diagnostics.map((x) => [x.id, x]));
    expect(byId.count.tone).toBe("bad");
    expect(byId.top.tone).toBe("bad");
    expect(byId.classes).toBeDefined();
    expect(byId.state.value).toBe("60%");
    expect(d.score).toBeLessThan(50);
  });

  it("dá nota alta para carteira equilibrada", () => {
    const names = ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1", "J1", "K1", "L1"];
    const many = names.map((t) => pos(t, 1000));
    const d = diagnose(many, (t) => ({ ...info(t), company: t, sector: `S${names.indexOf(t) % 6}` }));
    expect(d.score).toBeGreaterThanOrEqual(95);
  });
});

describe("pesos-alvo", () => {
  it("pesos iguais por empresa, respeitando limite de setor", () => {
    const ps = [pos("ITUB4", 5000), pos("BBAS3", 5000), pos("WEGE3", 1000), pos("TAEE11", 1000), pos("PETR4", 1000)];
    const { weights, notes } = targetWeights(ps, info, { ...DEFAULT_SETTINGS, maxAsset: 0.3, maxSector: 0.3 });
    expect(notes).toEqual([]);
    // Bancos (2 empresas) limitado a 30%; os outros 3 dividem 70%
    expect(weights.get("ITUB4")! + weights.get("BBAS3")!).toBeCloseTo(0.3);
    expect(weights.get("WEGE3")).toBeCloseTo(0.7 / 3);
    expect([...weights.values()].reduce((a, b) => a + b)).toBeCloseTo(1);
  });

  it("avisa quando há poucas empresas para o limite", () => {
    const { weights, notes } = targetWeights([pos("ITUB4", 1000), pos("WEGE3", 1000)], info, DEFAULT_SETTINGS);
    expect(notes[0]).toMatch(/Com 2 empresas/);
    expect(weights.get("ITUB4")).toBeCloseTo(0.5);
  });
});

describe("balanceamento", () => {
  const ps = [pos("ITUB4", 6000), pos("WEGE3", 2000, 50), pos("TAEE11", 2000, 40), pos("RUIM3", 500, 5)];
  const s = { ...DEFAULT_SETTINGS, maxAsset: 1, maxSector: 1, contribution: 3000 };

  it("aporte vai para quem está abaixo do alvo, em ações inteiras, sem comprar papel em alerta", () => {
    const plan = planRebalance(ps, info, s);
    const o = Object.fromEntries(plan.orders.map((x) => [x.ticker, x]));
    expect(o.ITUB4.shares).toBe(0);
    expect(o.RUIM3.shares).toBe(0);
    expect(o.RUIM3.note).toMatch(/sem compra/);
    expect(o.WEGE3.shares).toBeGreaterThan(0);
    expect(o.TAEE11.shares).toBeGreaterThan(0);
    expect(o.WEGE3.amount % 50).toBe(0);
    expect(plan.sold).toBe(0);
    expect(plan.bought + plan.leftover).toBeCloseTo(3000);
    expect(plan.leftover).toBeLessThan(50);
  });

  it("com vendas, reduz o que passou do alvo e avisa do imposto acima de R$ 20 mil", () => {
    const big = [pos("ITUB4", 90000), pos("WEGE3", 5000, 50), pos("TAEE11", 5000, 40)];
    const plan = planRebalance(big, info, { ...s, contribution: 0, allowSells: true });
    const o = Object.fromEntries(plan.orders.map((x) => [x.ticker, x]));
    expect(o.ITUB4.shares).toBeLessThan(0);
    expect(o.ITUB4.afterWeight).toBeCloseTo(1 / 3, 1);
    expect(plan.notes.some((n) => /20 mil/.test(n))).toBe(true);
  });

  it("aporte grande é distribuído sem sobrar mais que o preço de uma ação", () => {
    const plan = planRebalance([pos("ITUB4", 1000), pos("WEGE3", 1000, 50)], info, { ...s, contribution: 100000 });
    expect(plan.leftover).toBeLessThan(50);
    expect(plan.orders.find((o) => o.ticker === "ITUB4")!.afterWeight).toBeCloseTo(0.5, 2);
  });
});

describe("ideias para diversificar", () => {
  it("prioriza setores ausentes, sem repetir empresas e com limite por setor", async () => {
    const { diversifyIdeas } = await import("./rebalance");
    const d = diagnose([pos("ITUB4", 8000), pos("WEGE3", 2000)], (t) => ({ ...info(t), sector: t === "ITUB4" ? "Financeiro" : "Indústria" }));
    const cands = [
      { t: "BBDC4", c: "bradesco", s: "Financeiro" },
      { t: "ITSA4", c: "itau", s: "Financeiro" },
      { t: "TAEE11", c: "taesa", s: "Utilidade" },
      { t: "EGIE3", c: "engie", s: "Utilidade" },
      { t: "CPLE6", c: "copel", s: "Utilidade" },
      { t: "RAIL3", c: "rumo", s: "Indústria" },
      { t: "LREN3", c: "renner", s: "Consumo" },
    ];
    const ideas = diversifyIdeas(cands, (x) => ({ company: x.c, sector: x.s }), d, new Set(["itau", "weg"]));
    // Financeiro tem 80%: fica de fora; Indústria tem 20% (acima de 10%): fica de fora
    expect(ideas.map((i) => i.item.t)).toEqual(["TAEE11", "EGIE3", "LREN3"]);
    expect(ideas[0].reason).toMatch(/não tem utilidade/);
  });
});
