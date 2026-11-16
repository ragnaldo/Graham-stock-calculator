import { fmtCompact, fmtMultiple, fmtNumber, fmtPct, fmtPrice } from "../format";
import type { StockRow } from "../types";
import type { Criterion, Strategy } from "./types";
import { avg, avgEps3, finish, isNum, lastYears } from "./util";

const NA_FIN = "Não se aplica a bancos e seguradoras.";

/** Número de Graham: preço teto = √(22,5 × LPA × VPA). */
export const grahamNumber: Strategy = {
  id: "graham-number",
  name: "Número de Graham",
  short: "Nº Graham",
  columns: ["fair", "margin"],
  description:
    "Preço teto = √(22,5 × LPA × VPA). Vem do limite P/L ≤ 15 combinado com P/VP ≤ 1,5. Aprova quando a cotação está abaixo do teto com a margem de segurança exigida.",
  params: [
    { key: "multiplier", label: "Multiplicador (P/L × P/VP)", default: 22.5, min: 1, max: 100, step: 0.5 },
    { key: "minMargin", label: "Margem de segurança mínima", default: 0, min: -100, max: 95, step: 5, unit: "%" },
  ],
  evaluate(s, p) {
    const lpaOk = isNum(s.lpa) && s.lpa > 0;
    const vpaOk = isNum(s.vpa) && s.vpa > 0;
    const fair = lpaOk && vpaOk ? Math.sqrt(p.multiplier * (s.lpa as number) * (s.vpa as number)) : null;
    const margin = fair ? 1 - s.price / fair : null;
    const criteria: Criterion[] = [
      { id: "lpa", label: "LPA positivo", pass: isNum(s.lpa) ? lpaOk : null, value: fmtPrice(s.lpa), target: "> 0" },
      { id: "vpa", label: "VPA positivo", pass: isNum(s.vpa) ? vpaOk : null, value: fmtPrice(s.vpa), target: "> 0" },
      {
        id: "margin",
        label: "Cotação abaixo do preço teto",
        pass: margin === null ? (lpaOk || vpaOk || isNum(s.lpa) || isNum(s.vpa) ? false : null) : margin * 100 >= p.minMargin,
        value: fair ? `${fmtPrice(s.price)} vs teto ${fmtPrice(fair)} (margem ${fmtPct(margin)})` : "sem preço teto",
        target: `margem ≥ ${fmtNumber(p.minMargin, 0)}%`,
      },
    ];
    return finish(criteria, { fairValue: fair, price: s.price });
  },
};

/** Critérios do investidor defensivo (O Investidor Inteligente, cap. 14). */
export const grahamDefensive: Strategy = {
  id: "graham-defensive",
  name: "Investidor defensivo",
  short: "Defensivo",
  columns: ["score"],
  description:
    "Os 7 critérios de Graham para o investidor defensivo: tamanho, solidez financeira, estabilidade de lucros, histórico de dividendos, crescimento, P/L e P/VP moderados. Histórico anual da CVM (desde 2010).",
  params: [
    { key: "minRevenue", label: "Receita líquida mínima", default: 1000, min: 0, step: 100, unit: "R$ mi" },
    { key: "minCurrentRatio", label: "Liquidez corrente mínima", default: 2, min: 0, step: 0.1 },
    { key: "earningsYears", label: "Anos seguidos de lucro", default: 10, min: 1, max: 16, step: 1, unit: "anos" },
    { key: "dividendYears", label: "Anos seguidos de dividendos", default: 10, min: 1, max: 16, step: 1, unit: "anos", help: "Graham pedia 20; a base da CVM começa em 2010." },
    { key: "minGrowth", label: "Crescimento mínimo do lucro em 10 anos", default: 33, min: -100, step: 1, unit: "%" },
    { key: "maxPL", label: "P/L máximo (lucro médio de 3 anos)", default: 15, min: 1, step: 0.5 },
    { key: "maxPVP", label: "P/VP máximo", default: 1.5, min: 0.1, step: 0.1 },
    { key: "maxPLxPVP", label: "ou P/L × P/VP máximo", default: 22.5, min: 1, step: 0.5 },
    { key: "minCriteria", label: "Mínimo de critérios atendidos", default: 7, min: 1, max: 7, step: 1 },
  ],
  evaluate(s, p) {
    const h = s.history;
    const c: Criterion[] = [];

    // 1. tamanho
    const revenue = isNum(s.revenue) ? s.revenue : isNum(h?.balance?.rev) ? (h!.balance!.rev as number) * 1000 : null;
    c.push({
      id: "size",
      label: "Tamanho adequado",
      pass: revenue === null ? null : revenue >= p.minRevenue * 1e6,
      value: `receita ${fmtCompact(revenue)}`,
      target: `≥ ${fmtCompact(p.minRevenue * 1e6)}`,
    });

    // 2. solidez financeira
    const bal = h?.balance;
    const wc = isNum(bal?.ca) && isNum(bal?.cl) ? (bal!.ca as number) - (bal!.cl as number) : null;
    const debtOk = wc !== null && isNum(bal?.debtL) ? (bal!.debtL as number) <= wc : null;
    const liqOk = isNum(s.liqCorr) && s.liqCorr > 0 ? s.liqCorr >= p.minCurrentRatio : null;
    c.push({
      id: "strength",
      label: "Solidez financeira",
      na: s.financial,
      pass: s.financial ? null : liqOk === null ? null : liqOk && debtOk !== false,
      value: s.financial
        ? "–"
        : `liq. corrente ${fmtMultiple(s.liqCorr)}; dívida LP ${fmtCompact(isNum(bal?.debtL) ? (bal!.debtL as number) * 1000 : null)} vs capital de giro ${fmtCompact(wc !== null ? wc * 1000 : null)}`,
      target: `liq. corrente ≥ ${fmtMultiple(p.minCurrentRatio)} e dívida LP ≤ capital de giro`,
      note: s.financial ? NA_FIN : undefined,
    });

    // 3. estabilidade de lucros
    const ey = lastYears(h, p.earningsYears);
    const eKnown = ey.filter((r) => isNum(r.netIncome));
    const ePos = eKnown.filter((r) => (r.netIncome as number) > 0).length;
    c.push({
      id: "earnings",
      label: "Lucro em todos os anos",
      pass: eKnown.length === 0 ? null : ePos < eKnown.length ? false : eKnown.length >= p.earningsYears ? true : null,
      value: `${ePos} de ${eKnown.length} anos com lucro`,
      target: `${p.earningsYears} anos seguidos`,
      note: eKnown.length > 0 && eKnown.length < p.earningsYears ? "Histórico menor que o exigido." : undefined,
    });

    // 4. dividendos
    const dy = lastYears(h, p.dividendYears);
    const dKnown = dy.filter((r) => isNum(r.dividends));
    const dPos = dKnown.filter((r) => (r.dividends as number) > 0).length;
    c.push({
      id: "dividends",
      label: "Dividendos ininterruptos",
      pass: dKnown.length === 0 ? null : dPos < dKnown.length ? false : dKnown.length >= p.dividendYears ? true : null,
      value: `${dPos} de ${dKnown.length} anos com pagamento`,
      target: `${p.dividendYears} anos seguidos`,
      note: "Pagamentos lidos do fluxo de caixa (DFC) da CVM; aproximado.",
    });

    // 5. crescimento do lucro (média de 3 anos no início e no fim de 10 anos)
    const gy = lastYears(h, 10);
    let growth: number | null = null;
    if (gy.length >= 10) {
      const first = gy.slice(0, 3);
      const last = gy.slice(-3);
      const key = [...first, ...last].every((r) => isNum(r.eps)) ? "eps" : "netIncome";
      if ([...first, ...last].every((r) => isNum(r[key]))) {
        const a = avg(first.map((r) => r[key] as number));
        const b = avg(last.map((r) => r[key] as number));
        growth = a > 0 ? b / a - 1 : null;
        if (a <= 0) c.push({ id: "growth", label: "Crescimento do lucro", pass: false, value: "lucro médio inicial negativo", target: `≥ ${fmtNumber(p.minGrowth, 0)}% em 10 anos` });
      }
    }
    if (!c.some((x) => x.id === "growth"))
      c.push({
        id: "growth",
        label: "Crescimento do lucro",
        pass: growth === null ? null : growth * 100 >= p.minGrowth,
        value: growth === null ? "menos de 10 anos de dados" : fmtPct(growth),
        target: `≥ ${fmtNumber(p.minGrowth, 0)}% em 10 anos`,
      });

    // 6. P/L moderado sobre o lucro médio de 3 anos
    const eps3 = avgEps3(s);
    const pl3 = eps3 !== null && eps3 > 0 ? s.price / eps3 : null;
    c.push({
      id: "pl",
      label: "P/L moderado",
      pass: eps3 === null ? null : eps3 <= 0 ? false : (pl3 as number) <= p.maxPL,
      value: eps3 === null ? "sem histórico" : eps3 <= 0 ? "lucro médio negativo" : `${fmtMultiple(pl3)} (lucro médio 3 anos)`,
      target: `≤ ${fmtMultiple(p.maxPL)}`,
    });

    // 7. P/VP moderado
    const pvp = s.pvp;
    const plRef = pl3 ?? (isNum(s.pl) && s.pl > 0 ? s.pl : null);
    const product = isNum(pvp) && pvp > 0 && plRef !== null ? pvp * plRef : null;
    c.push({
      id: "pvp",
      label: "P/VP moderado",
      pass: !isNum(pvp) ? null : pvp <= 0 ? false : pvp <= p.maxPVP || (product !== null && product <= p.maxPLxPVP),
      value: `P/VP ${fmtMultiple(pvp)}; P/L × P/VP ${fmtMultiple(product)}`,
      target: `P/VP ≤ ${fmtMultiple(p.maxPVP)} ou P/L × P/VP ≤ ${fmtMultiple(p.maxPLxPVP)}`,
    });

    // preço teto: o menor entre os limites de P/L e P/VP combinados
    const fair = eps3 !== null && eps3 > 0 && isNum(s.vpa) && s.vpa > 0 ? Math.sqrt(p.maxPLxPVP * eps3 * s.vpa) : null;
    return finish(c, { minCriteria: p.minCriteria, fairValue: fair, price: s.price });
  },
};

/** Fórmula de valor intrínseco para ações de crescimento: V = LPA × (8,5 + 2g) × 4,4 / Y. */
export const grahamGrowth: Strategy = {
  id: "graham-growth",
  name: "Fórmula de crescimento",
  short: "Crescimento",
  columns: ["fair", "margin"],
  description:
    "Valor intrínseco = LPA × (8,5 + 2g) × 4,4 / Y, onde g é o crescimento anual esperado (aqui, o crescimento histórico do lucro, limitado) e Y a taxa de juros de referência. Com Y = 4,4 a fórmula fica na versão original, sem ajuste de juros.",
  params: [
    { key: "basePE", label: "P/L base (crescimento zero)", default: 8.5, min: 1, step: 0.5 },
    { key: "growthMult", label: "Multiplicador do crescimento", default: 2, min: 0, step: 0.5 },
    { key: "maxGrowth", label: "Teto do crescimento anual", default: 10, min: 0, max: 50, step: 1, unit: "%" },
    { key: "bondYield", label: "Taxa de referência Y", default: 4.4, min: 0.5, step: 0.1, unit: "%", help: "4,4 = neutro. Use a taxa real/nominal de longo prazo para penalizar juros altos." },
    { key: "minMargin", label: "Margem de segurança mínima", default: 0, min: -100, max: 95, step: 5, unit: "%" },
  ],
  evaluate(s, p) {
    const g = historicalGrowth(s);
    const gUsed = g === null ? 0 : Math.min(Math.max(g * 100, 0), p.maxGrowth);
    const lpaOk = isNum(s.lpa) && s.lpa > 0;
    const fair = lpaOk ? ((s.lpa as number) * (p.basePE + p.growthMult * gUsed) * 4.4) / p.bondYield : null;
    const margin = fair ? 1 - s.price / fair : null;
    const criteria: Criterion[] = [
      { id: "lpa", label: "LPA positivo", pass: isNum(s.lpa) ? lpaOk : null, value: fmtPrice(s.lpa), target: "> 0" },
      {
        id: "growth",
        label: "Crescimento histórico conhecido",
        pass: g === null ? null : true,
        na: true,
        value: g === null ? "sem histórico (assume 0%)" : `${fmtPct(g)} a.a. (usado: ${fmtNumber(gUsed, 1)}%)`,
        target: `limitado a 0–${fmtNumber(p.maxGrowth, 0)}% a.a.`,
      },
      {
        id: "margin",
        label: "Cotação abaixo do valor intrínseco",
        pass: margin === null ? (isNum(s.lpa) ? false : null) : margin * 100 >= p.minMargin,
        value: fair ? `${fmtPrice(s.price)} vs ${fmtPrice(fair)} (margem ${fmtPct(margin)})` : "sem valor intrínseco",
        target: `margem ≥ ${fmtNumber(p.minMargin, 0)}%`,
      },
    ];
    return finish(criteria, { fairValue: fair, price: s.price });
  },
};

/** Crescimento anual composto do lucro por ação: médias de 3 anos nas pontas da janela (até 10 anos). */
export function historicalGrowth(s: StockRow): number | null {
  const ys = lastYears(s.history, 10);
  if (ys.length < 6) return null;
  const first = ys.slice(0, 3);
  const last = ys.slice(-3);
  const key = [...first, ...last].every((r) => isNum(r.eps)) ? "eps" : "netIncome";
  if (![...first, ...last].every((r) => isNum(r[key]))) return null;
  const a = avg(first.map((r) => r[key] as number));
  const b = avg(last.map((r) => r[key] as number));
  if (a <= 0 || b <= 0) return null;
  return Math.pow(b / a, 1 / (ys.length - 3)) - 1;
}

/** Net-net: cotação abaixo de 2/3 do ativo circulante líquido (NCAV) por ação. */
export const grahamNetNet: Strategy = {
  id: "graham-netnet",
  name: "Net-net (NCAV)",
  short: "Net-net",
  columns: ["fair", "margin"],
  description:
    "Compra abaixo do valor de liquidação: ativo circulante menos todas as dívidas (NCAV) por ação. Graham pagava no máximo 2/3 desse valor. Raro na B3; costuma apontar empresas pequenas ou em dificuldade.",
  params: [{ key: "maxRatio", label: "Preço / NCAV máximo", default: 0.67, min: 0.05, max: 3, step: 0.01 }],
  evaluate(s, p) {
    const ratio = s.pAcl;
    const ncav = isNum(ratio) && ratio !== 0 ? s.price / ratio : null;
    const criteria: Criterion[] = [
      {
        id: "ncav",
        label: "NCAV positivo",
        na: s.financial,
        pass: s.financial ? null : ncav === null ? null : ncav > 0,
        value: s.financial ? "–" : ncav === null ? "sem dado" : `${fmtPrice(ncav)} por ação`,
        target: "> 0",
        note: s.financial ? NA_FIN : undefined,
      },
      {
        id: "ratio",
        label: "Cotação abaixo do NCAV",
        na: s.financial,
        pass: s.financial ? null : ncav === null ? null : ncav > 0 && (ratio as number) <= p.maxRatio,
        value: s.financial ? "–" : `preço / NCAV ${fmtMultiple(ratio)}`,
        target: `≤ ${fmtMultiple(p.maxRatio)}`,
      },
    ];
    const fair = ncav !== null && ncav > 0 ? ncav * p.maxRatio : null;
    return finish(criteria, { fairValue: fair, price: s.price });
  },
};
