import { describe, expect, it } from "vitest";
import { adjustPrices, buildAnnual, splitFactorAfter, summarize, type AnnualRaw, type Split } from "./history";

// desdobramento 1:2 em 2021: ações dobram, preço cai pela metade
const rows: AnnualRaw[] = [
  { y: 2020, con: true, ni: 100_000, eq: 500_000, rev: 1_000_000, div: 40_000, sh: 100_000_000 },
  { y: 2021, con: true, ni: 120_000, eq: 560_000, rev: 1_100_000, div: 50_000, sh: 200_000_000 },
];
const splits: Split[] = [["2021-05-10", 2]];
const monthly = { "2020-12": 20, "2021-04": 24, "2021-05": 12, "2021-12": 15 };

describe("ajuste por desdobramentos", () => {
  it("acumula os fatores posteriores à data", () => {
    expect(splitFactorAfter(splits, "2020-12-31")).toBe(2);
    expect(splitFactorAfter(splits, "2021-12-31")).toBe(1);
  });

  it("traz preços antigos para a base atual", () => {
    expect(adjustPrices(monthly, splits).map((p) => p.close)).toEqual([10, 12, 12, 15]);
  });

  it("mantém P/L e P/VP iguais aos da época e ajusta os valores por ação", () => {
    const [a, b] = buildAnnual({ rows, splits, unitShares: 1, monthly });
    expect(a.lpa).toBeCloseTo(0.5, 9); // 100 mi / 200 mi ações equivalentes
    expect(a.price).toBe(10);
    expect(a.pl).toBeCloseTo(20 / 1, 9); // na época: R$ 20 / LPA R$ 1
    expect(a.pvp).toBeCloseTo(20 / 5, 9);
    expect(b.lpa).toBeCloseTo(0.6, 9);
    expect(b.pl).toBeCloseTo(25, 9);
    expect(b.roe).toBeCloseTo(120 / 560, 9);
    expect(b.payout).toBeCloseTo(50 / 120, 9);
  });

  it("multiplica valores por ação pela composição da unit e desconta tesouraria", () => {
    const [a] = buildAnnual({ rows: [{ y: 2021, con: true, ni: 90_000, eq: 900_000, sh: 100_000_000, shTreas: 10_000_000 }], splits: [], unitShares: 3, monthly: {} });
    expect(a.lpa).toBeCloseTo(3, 9);
    expect(a.vpa).toBeCloseTo(30, 9);
    expect(a.price).toBeNull();
    expect(a.pl).toBeNull();
  });

  it("resume o histórico para os filtros", () => {
    const h = summarize(rows, splits, 1)!;
    expect(h.years).toEqual([2020, 2021]);
    expect(h.shares).toEqual([200_000_000, 200_000_000]);
    expect(h.balance?.year).toBe(2021);
  });
});
