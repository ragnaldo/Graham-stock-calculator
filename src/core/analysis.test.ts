import { describe, expect, it } from "vitest";
import { analyze } from "./analysis";
import { STRATEGIES, defaultParams, runStrategy } from "./strategies";
import type { AnnualPoint, StockDetail, StockRow } from "./types";

const year = (y: number, over: Partial<AnnualPoint> = {}): AnnualPoint => ({
  year: y,
  consolidated: true,
  revenue: 1000 * 1.1 ** (y - 2020),
  ebit: 200 * 1.1 ** (y - 2020),
  netIncome: 100 * 1.12 ** (y - 2020),
  equity: 600,
  assets: 1500,
  currentAssets: 500,
  currentLiabilities: 250,
  nonCurrentLiabilities: 300,
  grossDebt: 300,
  cash: 100,
  dividendsPaid: 50,
  lpa: 1,
  vpa: 6,
  dps: 0.5,
  price: 10,
  pl: 10,
  pvp: 1.6,
  dy: 0.05,
  roe: 0.18,
  netMargin: 0.1,
  ebitMargin: 0.2,
  payout: 0.5,
  currentRatio: 2,
  debtToEquity: 0.5,
  cashFromOps: 150,
  cashFromInvesting: y >= 2023 ? -120 : -60,
  ...over,
});

const row = { ticker: "TEST3", price: 8, pl: 6, pvp: 1.2, dy: 0.07, roe: 0.2, mrgLiq: 0.12, lpa: 1.33, vpa: 6.67, financial: false } as StockRow;

function detail(over: Partial<StockDetail> = {}): StockDetail {
  return {
    row,
    updatedAt: "",
    info: {} as StockDetail["info"],
    fundamentals: [],
    annual: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => year(y)),
    ttm: year(2026, { label: "12M até 3T26", netIncome: 230 }),
    quarters: [],
    prices: [],
    dividends: [],
    dividendsByYear: [],
    splits: [],
    gov: { segment: "Novo Mercado", control: "Privado", status: "Fase Operacional", holders: { controlPct: 40, treasuryPct: 0, freeFloatPct: 60, top: [], date: "" } },
    warnings: [],
    ...over,
  };
}

const results = (r: StockRow) =>
  STRATEGIES.filter((s) => !s.usesRules).map((s) => ({ strategy: s, result: runStrategy({ ...r, history: null } as StockRow, { id: s.id, params: defaultParams(s) })! }));

describe("análise", () => {
  it("resume pontos fortes, governança e sinais de expansão", () => {
    const a = analyze(detail(), results(row));
    const titles = a.sections.map((s) => s.title);
    expect(titles).toEqual(["Preço", "Rentabilidade", "Crescimento", "Endividamento", "Dividendos", "Caixa e investimentos", "Governança"]);
    expect(a.strengths.some((s) => s.startsWith("Segmento de listagem"))).toBe(true);
    expect(a.outlook[0]).toMatch(/Investimentos em alta/);
    expect(a.fairAverage).not.toBeNull();
  });

  it("aponta recuperação judicial, prejuízo e dívida alta", () => {
    const bad = detail({
      gov: { segment: "Básico", status: "Em Recuperação Judicial ou Equivalente" },
      ttm: year(2026, { label: "12M", netMargin: -0.05, ebit: -10, grossDebt: 2000, cash: 0, debtToEquity: 3, currentRatio: 0.6 }),
    });
    const a = analyze(bad, []);
    expect(a.concerns.some((c) => c.startsWith("Situação"))).toBe(true);
    expect(a.concerns.some((c) => c.startsWith("Dívida líquida / EBIT"))).toBe(true);
    expect(a.tone).toBe("bad");
  });

  it("não avalia endividamento de bancos", () => {
    const a = analyze(detail({ row: { ...row, financial: true } }), []);
    expect(a.sections.some((s) => s.id === "debt")).toBe(false);
  });
});
