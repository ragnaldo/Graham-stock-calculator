import { describe, expect, it } from "vitest";
import { computePortfolio, parseBackup, valueAt, type Benchmarks, type Operation, type PortfolioContext } from "./portfolio";

const ctx = (over: Partial<PortfolioContext> = {}): PortfolioContext => ({
  today: "2026-11-24",
  price: (t) => ({ AAAA3: 30, BBBB4: 10 })[t] ?? null,
  splits: () => [],
  dividends: () => [],
  monthly: () => ({}),
  name: (t) => `Empresa ${t}`,
  sector: (t) => (t === "AAAA3" ? "Energia" : "Bancos"),
  ...over,
});

const op = (o: Partial<Operation>): Operation => ({ id: Math.random().toString(), ticker: "AAAA3", type: "C", date: "2026-01-10", qty: 100, price: 20, ...o });

const bench: Benchmarks = {
  updatedAt: "2026-11-24",
  // índice dobra entre janeiro e novembro
  ibov: [
    ["2026-01-09", 100],
    ["2026-06-01", 150],
    ["2026-11-24", 200],
  ],
  cdi: [
    ["2026-01-09", 1],
    ["2026-06-01", 1.05],
    ["2026-11-24", 1.1],
  ],
};

describe("carteira", () => {
  it("calcula preço médio com taxas", () => {
    const s = computePortfolio([op({ qty: 100, price: 20, fees: 10 }), op({ date: "2026-03-01", qty: 100, price: 30 })], ctx(), null);
    const p = s.positions[0];
    expect(p.qty).toBe(200);
    expect(p.avgPrice).toBeCloseTo((2000 + 10 + 3000) / 200);
    expect(p.value).toBe(6000);
    expect(p.gain).toBeCloseTo(6000 - 5010);
  });

  it("vende pelo preço médio e registra o lucro realizado", () => {
    const s = computePortfolio([op({ qty: 100, price: 20 }), op({ type: "V", date: "2026-05-01", qty: 40, price: 25 })], ctx(), null);
    const p = s.positions[0];
    expect(p.qty).toBe(60);
    expect(p.avgPrice).toBe(20);
    expect(p.realized).toBe(40 * 5);
    expect(s.withdrawn).toBe(1000);
    // resultado = 60×30 + 1000 − 2000
    expect(s.result).toBe(800);
    expect(s.returnPct).toBeCloseTo(0.4);
  });

  it("corrige quantidade e preço médio por desdobramento posterior à compra", () => {
    const s = computePortfolio([op({ qty: 100, price: 40 })], ctx({ splits: () => [["2026-06-01", 2]], price: () => 25 }), null);
    expect(s.positions[0].qty).toBe(200);
    expect(s.positions[0].avgPrice).toBe(20);
    expect(s.positions[0].value).toBe(5000);
  });

  it("soma proventos pela posição na data com", () => {
    const dividends = () => [
      { date: "2026-01-05", value: 9 }, // antes da compra: não recebe
      { date: "2026-01-10", value: 1 }, // comprou na data com: recebe
      { date: "2026-08-01", value: 2 }, // depois da venda parcial
      { date: "2026-12-20", value: 5 }, // futuro: ignora
    ];
    const s = computePortfolio([op({ qty: 100 }), op({ type: "V", date: "2026-07-01", qty: 50, price: 20 })], ctx({ dividends }), null);
    expect(s.dividends).toBe(100 * 1 + 50 * 2);
  });

  it("compara com Ibovespa e CDI usando os mesmos aportes", () => {
    const s = computePortfolio([op({ qty: 100, price: 20, date: "2026-01-10" })], ctx(), bench);
    // R$ 2.000 no índice a 100 -> 20 unidades -> hoje a 200 = R$ 4.000
    expect(s.ibov!.value).toBeCloseTo(4000);
    expect(s.ibov!.returnPct).toBeCloseTo(1);
    expect(s.cdi!.returnPct).toBeCloseTo(0.1);
    expect(s.returnPct).toBeCloseTo(0.5); // 100 × 30 = 3.000
    expect(s.series.at(-1)!.date).toBe("2026-11-24");
    expect(s.series.at(-1)!.portfolio).toBeCloseTo(0.5);
    expect(s.series.at(-1)!.ibov).toBeCloseTo(1);
  });

  it("agrupa por setor e encerra posições zeradas", () => {
    const s = computePortfolio(
      [op({ qty: 100 }), op({ ticker: "BBBB4", qty: 300, price: 10 }), op({ ticker: "BBBB4", type: "V", date: "2026-02-01", qty: 300, price: 12 })],
      ctx(),
      null,
    );
    expect(s.positions.map((p) => p.ticker)).toEqual(["AAAA3"]);
    expect(s.closed).toEqual([{ ticker: "BBBB4", realized: 600, dividends: 0 }]);
    expect(s.bySector).toEqual([{ sector: "Energia", value: 3000, weight: 1 }]);
  });

  it("ignora venda maior que a posição e operações futuras", () => {
    const s = computePortfolio([op({ qty: 10 }), op({ type: "V", date: "2026-02-01", qty: 50, price: 25 }), op({ date: "2027-01-01" })], ctx(), null);
    expect(s.positions).toEqual([]);
    expect(s.warnings.length).toBe(2);
  });
});

describe("utilitários", () => {
  it("busca o último valor até a data", () => {
    expect(valueAt(bench.ibov, "2026-03-01")).toBe(100);
    expect(valueAt(bench.ibov, "2026-06-01")).toBe(150);
    expect(valueAt(bench.ibov, "2025-01-01")).toBeNull();
  });

  it("valida backups", () => {
    const ops = parseBackup(JSON.stringify({ operations: [{ ticker: "petr4", type: "C", date: "2026-01-02", qty: 10, price: 30 }] }));
    expect(ops[0].ticker).toBe("PETR4");
    expect(() => parseBackup(JSON.stringify({ operations: [{ ticker: "X", type: "C" }] }))).toThrow();
  });
});
