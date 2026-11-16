import { describe, expect, it } from "vitest";
import type { StockRow } from "../types";
import { DEFAULT_CONFIG, customFilter, defaultParams, runStrategy, screen } from "./index";
import { grahamDefensive, grahamGrowth, grahamNetNet, grahamNumber, historicalGrowth } from "./graham";

const years = Array.from({ length: 10 }, (_, i) => 2016 + i);

function stock(over: Partial<StockRow> = {}): StockRow {
  return {
    ticker: "TEST3",
    price: 20,
    pl: 5,
    pvp: 2,
    psr: 1,
    dy: 0.06,
    pAtivo: null,
    pCapGiro: null,
    pEbit: null,
    pAcl: null,
    evEbit: null,
    evEbitda: null,
    mrgBruta: null,
    mrgEbit: null,
    mrgLiq: 0.1,
    liqCorr: 2.5,
    roic: 0.15,
    roe: 0.2,
    liq2m: 5_000_000,
    patrimLiq: 1e9,
    divPatrim: 0.3,
    cresRec5a: 0.1,
    name: "Teste S.A.",
    sector: "Teste",
    financial: false,
    cnpj: "00.000.000/0001-00",
    lpa: 4,
    vpa: 10,
    marketCap: 2e9,
    revenue: 2e9,
    history: {
      years,
      // lucro em R$ mil: cresce de 200 mi para 380 mi
      netIncome: years.map((_, i) => 200_000 + i * 20_000),
      dividends: years.map(() => 50_000),
      shares: years.map(() => 100_000_000),
      balance: { year: 2025, ca: 900_000, cl: 400_000, ncl: 300_000, debtL: 200_000, rev: 2_000_000 },
    },
    ...over,
  };
}

const run = (s: Parameters<typeof runStrategy>[0], id: string, params = {}) => runStrategy(s, { id, params })!;

describe("Número de Graham", () => {
  it("calcula o preço teto √(22,5 × LPA × VPA)", () => {
    const r = run(stock(), grahamNumber.id);
    expect(r.fairValue).toBeCloseTo(30, 6);
    expect(r.margin).toBeCloseTo(1 - 20 / 30, 6);
    expect(r.pass).toBe(true);
  });

  it("reprova quando a margem exigida não é atingida", () => {
    expect(run(stock(), grahamNumber.id, { minMargin: 40 }).pass).toBe(false);
    expect(run(stock({ price: 31 }), grahamNumber.id).pass).toBe(false);
  });

  it("não gera preço teto com lucro ou patrimônio negativos", () => {
    const r = run(stock({ lpa: -1 }), grahamNumber.id);
    expect(r.fairValue).toBeNull();
    expect(r.pass).toBe(false);
  });
});

describe("Investidor defensivo", () => {
  it("aprova a empresa que atende os 7 critérios", () => {
    // P/L médio 3 anos = 20 / 3,6 = 5,6; P/VP 2 mas P/L × P/VP = 11 ≤ 22,5
    const r = run(stock(), grahamDefensive.id);
    expect(r.criteria.map((c) => [c.id, c.pass])).toEqual([
      ["size", true],
      ["strength", true],
      ["earnings", true],
      ["dividends", true],
      ["growth", true],
      ["pl", true],
      ["pvp", true],
    ]);
    expect(r.score).toBe(7);
    expect(r.pass).toBe(true);
  });

  it("reprova com um ano de prejuízo ou sem dividendo", () => {
    const h = stock().history!;
    const loss = stock({ history: { ...h, netIncome: h.netIncome.map((v, i) => (i === 4 ? -1 : v)) } });
    expect(run(loss, grahamDefensive.id).criteria.find((c) => c.id === "earnings")!.pass).toBe(false);
    const noDiv = stock({ history: { ...h, dividends: h.dividends.map((v, i) => (i === 7 ? 0 : v)) } });
    expect(run(noDiv, grahamDefensive.id).criteria.find((c) => c.id === "dividends")!.pass).toBe(false);
  });

  it("marca histórico curto como dado insuficiente, não como aprovado", () => {
    const h = stock().history!;
    const short = stock({ history: { ...h, years: h.years.slice(-4), netIncome: h.netIncome.slice(-4), dividends: h.dividends.slice(-4), shares: h.shares.slice(-4) } });
    const r = run(short, grahamDefensive.id);
    expect(r.criteria.find((c) => c.id === "earnings")!.pass).toBeNull();
    expect(r.pass).toBe(false);
  });

  it("deixa a solidez financeira fora da pontuação em bancos", () => {
    const r = run(stock({ financial: true, liqCorr: null }), grahamDefensive.id);
    expect(r.maxScore).toBe(6);
    expect(r.pass).toBe(true);
  });

  it("aceita menos critérios quando o mínimo é reduzido", () => {
    const weak = stock({ liqCorr: 1.1 });
    expect(run(weak, grahamDefensive.id).pass).toBe(false);
    expect(run(weak, grahamDefensive.id, { minCriteria: 6 }).pass).toBe(true);
  });
});

describe("Fórmula de crescimento", () => {
  it("usa o crescimento histórico limitado ao teto", () => {
    const s = stock();
    const g = historicalGrowth(s)!;
    // médias de 3 anos: 220 mi -> 360 mi em 7 anos
    expect(g).toBeCloseTo(Math.pow(360 / 220, 1 / 7) - 1, 6);
    const r = run(s, grahamGrowth.id, { maxGrowth: 5 });
    expect(r.fairValue).toBeCloseTo(4 * (8.5 + 2 * 5), 6);
  });

  it("reduz o valor quando a taxa de referência sobe", () => {
    const base = run(stock(), grahamGrowth.id).fairValue!;
    expect(run(stock(), grahamGrowth.id, { bondYield: 8.8 }).fairValue).toBeCloseTo(base / 2, 6);
  });
});

describe("Net-net", () => {
  it("aprova só abaixo de 2/3 do NCAV", () => {
    expect(run(stock({ pAcl: 0.5 }), grahamNetNet.id).pass).toBe(true);
    expect(run(stock({ pAcl: 0.9 }), grahamNetNet.id).pass).toBe(false);
    expect(run(stock({ pAcl: -3 }), grahamNetNet.id).pass).toBe(false);
  });
});

describe("triagem", () => {
  const a = stock({ ticker: "AAAA3", liq2m: 1e6 });
  const b = stock({ ticker: "AAAA4", liq2m: 9e6 });
  const c = stock({ ticker: "BBBB3", cnpj: "11.111.111/0001-11", price: 100, liq2m: 2e6 });
  const d = stock({ ticker: "CCCC3", cnpj: "22.222.222/0001-22", liq2m: 1000 });

  it("aplica liquidez mínima e um papel por empresa", () => {
    const out = screen([a, b, c, d], DEFAULT_CONFIG);
    expect(out.map((e) => e.stock.ticker).sort()).toEqual(["AAAA4", "BBBB3"]);
    expect(out.find((e) => e.stock.ticker === "AAAA4")!.pass).toBe(true);
    expect(out.find((e) => e.stock.ticker === "BBBB3")!.pass).toBe(false);
  });

  it("combina estratégias com E e OU", () => {
    const active = [
      { id: grahamNumber.id, params: defaultParams(grahamNumber) },
      { id: customFilter.id, params: {}, rules: [{ field: "roe", op: ">=" as const, value: 30 }] },
    ];
    const all = screen([b], { ...DEFAULT_CONFIG, active, combine: "all" });
    const any = screen([b], { ...DEFAULT_CONFIG, active, combine: "any" });
    expect(all[0].pass).toBe(false); // ROE 20% < 30%
    expect(any[0].pass).toBe(true);
  });
});
