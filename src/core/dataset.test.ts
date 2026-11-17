import { describe, expect, it } from "vitest";
import { buildDetail, indexDataset, repriceSnapshot, toRow, type WebDataset } from "./dataset";
import type { Snapshot } from "./types";

const snap: Snapshot = {
  ticker: "TEST4",
  price: 20,
  pl: 10,
  pvp: 2,
  psr: 1,
  dy: 0.05,
  pAtivo: 0.5,
  pCapGiro: null,
  pEbit: 8,
  pAcl: -1,
  evEbit: 9,
  evEbitda: 7,
  mrgBruta: 0.3,
  mrgEbit: 0.2,
  mrgLiq: 0.1,
  liqCorr: 1.5,
  roic: 0.12,
  roe: 0.2,
  liq2m: 1e6,
  patrimLiq: 1e9,
  divPatrim: 0.5,
  cresRec5a: 0.1,
};

const ds: WebDataset = {
  quotesAt: "2026-11-17T00:00:00Z",
  historyAt: null,
  lastFiscalYear: 2025,
  snapshots: [snap],
  companies: [{ cnpj: "1", name: "Teste S.A.", sector: "Teste", financial: false, tickers: { TEST4: { kind: "PN" } } }],
  annual: { "1": [{ y: 2025, con: true, ni: 100_000, eq: 1_000_000, sh: 100_000_000 }] },
  prices: { TEST4: { m: { "2025-06": 10, "2025-12": 12 }, last: "20251230", splits: [["2025-09-01", 2]] } },
  extras: {
    TEST4: {
      info: { company: "TESTE PN", type: "PN", sector: null, subsector: null, lastQuoteDate: null, lastBalanceDate: null, min52: null, max52: null, marketCap: null, enterpriseValue: null, shares: null, avgVolume2m: null },
      f: [["P/L", 10, "x"]],
      d: [["2025-05-02", "DIVIDENDO", 1, null], ["2025-11-03", "JRS CAP PROPRIO", 0.5, "2025-12-01"]],
    },
  },
};

describe("base embutida", () => {
  it("recalcula múltiplos de preço e o DY com a cotação nova", () => {
    const s = repriceSnapshot(snap, 25);
    expect(s.price).toBe(25);
    expect(s.pl).toBeCloseTo(12.5);
    expect(s.pvp).toBeCloseTo(2.5);
    expect(s.pAcl).toBeCloseTo(-1.25);
    expect(s.dy).toBeCloseTo(0.04);
    expect(s.evEbit).toBe(9); // EV não depende só do preço: fica como coletado
    expect(s.roe).toBe(0.2);
  });

  it("mantém LPA e VPA ao mudar o preço", () => {
    const td = indexDataset(ds);
    const a = toRow(snap, td("TEST4"));
    const b = toRow(repriceSnapshot(snap, 25), td("TEST4"));
    expect(b.lpa).toBeCloseTo(a.lpa!);
    expect(b.vpa).toBeCloseTo(a.vpa!);
  });

  it("monta o detalhe com proventos ajustados por desdobramento", () => {
    const td = indexDataset(ds);
    const d = buildDetail(toRow(snap, td("TEST4")), ds.extras.TEST4, td("TEST4"));
    // provento anterior ao desdobramento 1:2 é dividido por 2
    expect(d.dividends.map((x) => x.value)).toEqual([0.5, 0.5]);
    expect(d.dividendsByYear).toEqual([{ year: 2025, value: 1 }]);
    expect(d.prices.map((p) => p.close)).toEqual([5, 12]);
    expect(d.annual[0].dps).toBe(1);
    expect(d.warnings).toEqual([]);
  });

  it("avisa quando falta cadastro ou detalhes", () => {
    const d = buildDetail(toRow({ ...snap, ticker: "NADA3" }, null), null, null);
    expect(d.annual).toEqual([]);
    expect(d.warnings.length).toBe(2);
  });
});
