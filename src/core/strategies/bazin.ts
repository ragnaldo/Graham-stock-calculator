import { fmtMultiple, fmtNumber, fmtPct, fmtPrice } from "../format";
import type { Criterion, Strategy } from "./types";
import { avg, finish, isNum, lastYears } from "./util";

/** Método Bazin: preço teto = proventos por ação ÷ rendimento mínimo desejado (6% ao ano). */
export const bazin: Strategy = {
  id: "bazin",
  name: "Preço teto de Bazin",
  short: "Bazin",
  columns: ["fair", "margin"],
  description:
    "Décio Bazin pagava no máximo o preço que garante 6% ao ano em dividendos: teto = proventos por ação ÷ 6%. Usa a média dos últimos anos (CVM) ou os 12 meses, o que for menor, e exige dívida moderada e dividendos constantes.",
  params: [
    { key: "minYield", label: "Rendimento mínimo", default: 6, min: 1, max: 30, step: 0.5, unit: "%" },
    { key: "years", label: "Anos na média de proventos", default: 3, min: 1, max: 10, step: 1, unit: "anos" },
    { key: "maxDebt", label: "Dívida bruta / patrimônio máxima", default: 1, min: 0, step: 0.1 },
    { key: "dividendYears", label: "Anos seguidos pagando", default: 5, min: 1, max: 15, step: 1, unit: "anos" },
  ],
  evaluate(s, p) {
    const dps12 = isNum(s.dy) && s.dy > 0 ? s.dy * s.price : null;
    const hist = lastYears(s.history, p.years).filter((r) => isNum(r.dividends) && isNum(r.eps));
    // proventos por ação da CVM: dividendos pagos ÷ ações (mesma base do LPA ajustado)
    const perShare = hist
      .map((r) => {
        const i = s.history!.years.indexOf(r.year);
        const sh = s.history!.shares[i];
        return isNum(sh) && sh > 0 ? ((r.dividends as number) * 1000) / sh : null;
      })
      .filter(isNum);
    const dpsAvg = perShare.length === p.years ? avg(perShare) : null;
    const base = dpsAvg !== null && dps12 !== null ? Math.min(dpsAvg, dps12) : (dps12 ?? dpsAvg);
    const fair = base !== null && base > 0 ? base / (p.minYield / 100) : null;
    const margin = fair ? 1 - s.price / fair : null;

    const paid = lastYears(s.history, p.dividendYears).filter((r) => isNum(r.dividends));
    const paidYears = paid.filter((r) => (r.dividends as number) > 0).length;
    const criteria: Criterion[] = [
      {
        id: "fair",
        label: "Cotação abaixo do preço teto",
        pass: fair === null ? (base === null ? null : false) : (margin as number) >= 0,
        value: fair ? `${fmtPrice(s.price)} vs teto ${fmtPrice(fair)} (proventos ${fmtPrice(base)} por ação)` : "sem proventos",
        target: `rendimento ≥ ${fmtNumber(p.minYield, 1)}% ao ano`,
      },
      {
        id: "debt",
        label: "Dívida moderada",
        na: s.financial,
        pass: s.financial ? null : isNum(s.divPatrim) ? s.divPatrim <= p.maxDebt : null,
        value: s.financial ? "–" : `dívida / patrimônio ${fmtMultiple(s.divPatrim)}`,
        target: `≤ ${fmtMultiple(p.maxDebt)}`,
        note: s.financial ? "Não se aplica a bancos e seguradoras." : undefined,
      },
      {
        id: "constancy",
        label: "Dividendos constantes",
        pass: paid.length === 0 ? null : paidYears < paid.length ? false : paid.length >= p.dividendYears ? true : null,
        value: `${paidYears} de ${paid.length} anos com pagamento`,
        target: `${p.dividendYears} anos seguidos`,
      },
    ];
    const r = finish(criteria, { fairValue: fair, price: s.price });
    if (dps12 !== null && r.criteria[0].note === undefined) r.criteria[0].note = `DY atual ${fmtPct(s.dy)}.`;
    return r;
  },
};
