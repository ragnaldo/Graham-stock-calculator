// Análise completa de uma empresa a partir dos dados coletados: preço, rentabilidade, crescimento,
// endividamento, dividendos, caixa, governança e sinais sobre o futuro. Regras fixas, sem opinião humana.
import { fmtCompact, fmtMultiple, fmtPct, fmtPrice } from "./format";
import type { Strategy, StrategyResult } from "./strategies";
import type { AnnualPoint, StockDetail } from "./types";

export type Tone = "good" | "neutral" | "bad";

export interface AnalysisItem {
  label: string;
  value: string;
  tone: Tone;
  note?: string;
}

export interface AnalysisSection {
  id: string;
  title: string;
  items: AnalysisItem[];
  tone: Tone;
}

export interface Analysis {
  tone: Tone;
  headline: string;
  strengths: string[];
  concerns: string[];
  fairValues: { name: string; value: number; margin: number | null }[];
  /** Média dos preços teto calculados. */
  fairAverage: number | null;
  sections: AnalysisSection[];
  /** Sinais sobre o futuro tirados dos números (investimento, crescimento recente). */
  outlook: string[];
}

const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const k = (v: number | null | undefined) => (ok(v) ? fmtCompact(v * 1000) : "–");

/** Crescimento anual composto entre o primeiro e o último valor positivo da janela. */
function cagr(rows: AnnualPoint[], key: "revenue" | "netIncome", years: number): number | null {
  const win = rows.slice(-(years + 1));
  if (win.length < 3) return null;
  const a = win[0][key];
  const b = win[win.length - 1][key];
  if (!ok(a) || !ok(b) || a <= 0 || b <= 0) return null;
  return Math.pow(b / a, 1 / (win.length - 1)) - 1;
}

function tone3(v: number | null, good: (x: number) => boolean, bad: (x: number) => boolean): Tone {
  if (!ok(v)) return "neutral";
  return good(v) ? "good" : bad(v) ? "bad" : "neutral";
}

function sectionTone(items: AnalysisItem[]): Tone {
  const g = items.filter((i) => i.tone === "good").length;
  const b = items.filter((i) => i.tone === "bad").length;
  return g > b ? "good" : b > g ? "bad" : "neutral";
}

export function analyze(d: StockDetail, results: { strategy: Strategy; result: StrategyResult }[]): Analysis {
  const { row, annual, ttm, gov } = d;
  const recent = annual.slice(-5);
  const sections: AnalysisSection[] = [];
  const add = (id: string, title: string, items: AnalysisItem[]) => {
    if (items.length) sections.push({ id, title, items, tone: sectionTone(items) });
  };

  // ---------- preço ----------
  // net-net só conta quando o papel passa: o valor de liquidação costuma ser irrisório
  const fairValues = results
    .filter((r) => ok(r.result.fairValue) && (r.strategy.id !== "graham-netnet" || r.result.pass === true))
    .map((r) => ({ name: r.strategy.name, value: r.result.fairValue as number, margin: r.result.margin }));
  const fairAverage = median(fairValues.map((f) => f.value));
  const avgMargin = fairAverage ? 1 - row.price / fairAverage : null;
  const plHist = mean(recent.map((a) => a.pl).filter((x): x is number => ok(x) && x > 0 && x < 100));
  const pvpHist = mean(recent.map((a) => a.pvp).filter((x): x is number => ok(x) && x > 0));
  const priceItems: AnalysisItem[] = fairValues.map((f) => ({
    label: `Preço teto: ${f.name}`,
    value: `${fmtPrice(f.value)} (${ok(f.margin) ? `${f.margin >= 0 ? "+" : "−"}${fmtPct(Math.abs(f.margin))} de margem` : "–"})`,
    tone: tone3(f.margin, (m) => m >= 0.2, (m) => m < 0),
  }));
  if (fairAverage)
    priceItems.unshift({
      label: "Preço teto central (mediana)",
      value: `${fmtPrice(fairAverage)} vs cotação ${fmtPrice(row.price)}`,
      tone: tone3(avgMargin, (m) => m >= 0.2, (m) => m < 0),
      note: ok(avgMargin) ? (avgMargin >= 0 ? `Cotação ${fmtPct(avgMargin)} abaixo da mediana.` : `Cotação ${fmtPct(-avgMargin)} acima da mediana.`) : undefined,
    });
  if (ok(row.pl) && row.pl > 0 && plHist)
    priceItems.push({
      label: "P/L atual vs média de 5 anos",
      value: `${fmtMultiple(row.pl)} vs ${fmtMultiple(plHist)}`,
      tone: tone3(row.pl / plHist, (r) => r <= 0.85, (r) => r >= 1.25),
    });
  if (ok(row.pvp) && row.pvp > 0 && pvpHist)
    priceItems.push({
      label: "P/VP atual vs média de 5 anos",
      value: `${fmtMultiple(row.pvp)} vs ${fmtMultiple(pvpHist)}`,
      tone: tone3(row.pvp / pvpHist, (r) => r <= 0.85, (r) => r >= 1.25),
    });
  add("price", "Preço", priceItems);

  // ---------- rentabilidade ----------
  const roeNow = ttm?.roe ?? row.roe;
  const roeHist = mean(recent.map((a) => a.roe).filter(ok));
  const marginNow = ttm?.netMargin ?? row.mrgLiq;
  const marginHist = mean(annual.slice(-3).map((a) => a.netMargin).filter(ok));
  add("profit", "Rentabilidade", [
    ...(ok(roeNow) ? [{ label: "ROE (12 meses)", value: fmtPct(roeNow), tone: tone3(roeNow, (x) => x >= 0.15, (x) => x < 0.08) }] : []),
    ...(roeHist !== null ? [{ label: "ROE médio de 5 anos", value: fmtPct(roeHist), tone: tone3(roeHist, (x) => x >= 0.15, (x) => x < 0.08) }] : []),
    ...(ok(marginNow) && marginHist !== null
      ? [
          {
            label: "Margem líquida: 12 meses vs média de 3 anos",
            value: `${fmtPct(marginNow)} vs ${fmtPct(marginHist)}`,
            tone: marginNow < 0 ? ("bad" as Tone) : tone3(marginNow - marginHist, (x) => x > 0.01, (x) => x < -0.02),
          },
        ]
      : []),
  ]);

  // ---------- crescimento ----------
  const revG = cagr(annual, "revenue", 5);
  const niG = cagr(annual, "netIncome", 5);
  const lastYear = annual[annual.length - 1];
  const ttmVsYear = ttm && lastYear && ok(ttm.netIncome) && ok(lastYear.netIncome) && lastYear.netIncome > 0 ? ttm.netIncome / lastYear.netIncome - 1 : null;
  add("growth", "Crescimento", [
    ...(revG !== null ? [{ label: "Receita: crescimento anual (5 anos)", value: fmtPct(revG), tone: tone3(revG, (x) => x >= 0.05, (x) => x < 0) }] : []),
    ...(niG !== null ? [{ label: "Lucro: crescimento anual (5 anos)", value: fmtPct(niG), tone: tone3(niG, (x) => x >= 0.05, (x) => x < 0) }] : []),
    ...(ttmVsYear !== null
      ? [{ label: `Lucro 12 meses vs ${lastYear.year}`, value: `${ttmVsYear >= 0 ? "+" : "−"}${fmtPct(Math.abs(ttmVsYear))}`, tone: tone3(ttmVsYear, (x) => x >= 0.05, (x) => x < -0.1) }]
      : []),
  ]);

  // ---------- endividamento ----------
  const base = ttm ?? lastYear;
  if (!row.financial && base) {
    const netDebt = ok(base.grossDebt) ? base.grossDebt - (base.cash ?? 0) : null;
    const ndEbit = netDebt !== null && ok(base.ebit) && base.ebit > 0 ? netDebt / base.ebit : null;
    add("debt", "Endividamento", [
      ...(netDebt !== null
        ? [
            {
              label: "Dívida líquida / EBIT",
              value: netDebt <= 0 ? `caixa líquido de ${k(-netDebt)}` : ndEbit !== null ? `${fmtMultiple(ndEbit)} (dívida líquida ${k(netDebt)})` : `dívida líquida ${k(netDebt)}, EBIT negativo`,
              tone: netDebt <= 0 ? ("good" as Tone) : ndEbit === null ? ("bad" as Tone) : tone3(ndEbit, (x) => x <= 1.5, (x) => x > 3),
            },
          ]
        : []),
      ...(ok(base.debtToEquity) ? [{ label: "Dívida bruta / patrimônio", value: fmtMultiple(base.debtToEquity), tone: tone3(base.debtToEquity, (x) => x <= 0.5, (x) => x > 1.5) }] : []),
      ...(ok(base.currentRatio) ? [{ label: "Liquidez corrente", value: fmtMultiple(base.currentRatio), tone: tone3(base.currentRatio, (x) => x >= 1.5, (x) => x < 1) }] : []),
    ]);
  }

  // ---------- dividendos ----------
  let streak = 0;
  for (let i = annual.length - 1; i >= 0; i--) {
    const v = annual[i].dps ?? annual[i].dividendsPaid;
    if (ok(v) && v > 0) streak++;
    else break;
  }
  const payout = mean(annual.slice(-3).map((a) => a.payout).filter(ok));
  add("dividends", "Dividendos", [
    ...(ok(row.dy) ? [{ label: "Dividend yield (12 meses)", value: fmtPct(row.dy), tone: tone3(row.dy, (x) => x >= 0.06, () => false) }] : []),
    ...(payout !== null
      ? [{ label: "Payout médio (3 anos)", value: fmtPct(payout, 0), tone: tone3(payout, (x) => x >= 0.25 && x <= 0.8, (x) => x > 1.0), note: payout > 1 ? "Pagou mais do que lucrou." : undefined }]
      : []),
    ...(annual.length ? [{ label: "Anos seguidos pagando", value: `${streak} de ${annual.length}`, tone: tone3(streak, (x) => x >= 8, (x) => x < 3) }] : []),
  ]);

  // ---------- caixa e investimentos ----------
  const withCash = annual.filter((a) => ok(a.cashFromOps));
  const lastCash = withCash[withCash.length - 1];
  const capex = (a: AnnualPoint) => (ok(a.cashFromInvesting) ? -a.cashFromInvesting : null);
  if (lastCash) {
    const fcf = ok(lastCash.cashFromInvesting) ? (lastCash.cashFromOps as number) + lastCash.cashFromInvesting : null;
    add("cash", "Caixa e investimentos", [
      { label: `Caixa das operações (${lastCash.year})`, value: k(lastCash.cashFromOps), tone: tone3(lastCash.cashFromOps ?? null, (x) => x > 0, (x) => x < 0) },
      ...(capex(lastCash) !== null ? [{ label: `Investimentos (${lastCash.year})`, value: k(capex(lastCash)), tone: "neutral" as Tone }] : []),
      ...(fcf !== null ? [{ label: `Fluxo de caixa livre (${lastCash.year})`, value: k(fcf), tone: tone3(fcf, (x) => x > 0, (x) => x < 0) }] : []),
    ]);
  }

  // ---------- governança ----------
  if (gov) {
    const seg = gov.segment ?? "";
    const items: AnalysisItem[] = [];
    if (seg)
      items.push({
        label: "Segmento de listagem",
        value: seg,
        tone: /novo mercado/i.test(seg) ? "good" : /b[áa]sico|tradicional/i.test(seg) ? "bad" : "neutral",
        note: /novo mercado/i.test(seg)
          ? "Só ações ordinárias e 100% de tag along: o minoritário vota e recebe o mesmo preço do controlador numa venda."
          : /n[íi]vel 2/i.test(seg)
            ? "Regras próximas do Novo Mercado, mas pode ter ações preferenciais."
            : /n[íi]vel 1/i.test(seg)
              ? "Exige mais transparência que o básico, sem direitos extras ao minoritário."
              : "Sem compromissos adicionais de governança.",
      });
    if (gov.control)
      items.push({
        label: "Controle",
        value: gov.control,
        tone: "neutral",
        note: /estatal/i.test(gov.control) ? "Controle estatal: decisões podem atender a interesses do governo." : undefined,
      });
    if (gov.status) items.push({ label: "Situação", value: gov.status, tone: /operacional/i.test(gov.status) && !/pr[ée]-?operacional/i.test(gov.status) ? "good" : "bad" });
    if (gov.holders?.freeFloatPct !== undefined && gov.holders?.freeFloatPct !== null)
      items.push({
        label: "Ações em circulação (free float)",
        value: `${gov.holders.freeFloatPct.toFixed(1).replace(".", ",")}%`,
        tone: tone3(gov.holders.freeFloatPct, (x) => x >= 25, (x) => x < 15),
      });
    if (gov.auditor) items.push({ label: "Auditor", value: gov.auditor, tone: "neutral", note: gov.auditorSince ? `Desde ${gov.auditorSince.slice(0, 4)}.` : undefined });
    add("gov", "Governança", items);
  }

  // ---------- sinais sobre o futuro ----------
  const outlook: string[] = [];
  // fluxo de investimento líquido (investimentos menos vendas de ativos); só compara quando foi saída nos 6 anos
  const caps = withCash.slice(-6).map(capex);
  if (caps.length === 6 && caps.every((c) => ok(c) && c > 0)) {
    const a = mean(caps.slice(-3) as number[])!;
    const b = mean(caps.slice(0, 3) as number[])!;
    const ch = a / b - 1;
    outlook.push(
      ch > 1
        ? "Investimentos mais que dobraram: média dos últimos 3 anos contra os 3 anteriores. Costuma indicar expansão em andamento."
        : ch > 0.2
          ? `Investimentos em alta: média dos últimos 3 anos ${fmtPct(ch, 0)} acima dos 3 anteriores. Costuma indicar expansão em andamento.`
          : ch < -0.2
            ? `Investimentos em queda: média dos últimos 3 anos ${fmtPct(-ch, 0)} abaixo dos 3 anteriores. Pode indicar fim de um ciclo de obras ou preservação de caixa.`
            : "Investimentos estáveis nos últimos 6 anos.",
    );
  }
  if (ttmVsYear !== null) outlook.push(`Lucro dos últimos 12 meses ${ttmVsYear >= 0 ? "acima" : "abaixo"} do exercício ${lastYear.year} em ${fmtPct(Math.abs(ttmVsYear))}.`);
  const lastQ = d.quarters[d.quarters.length - 1];
  if (lastQ && ok(lastQ.netIncomeYoY))
    outlook.push(`No ${lastQ.label}, o lucro ${lastQ.netIncomeYoY >= 0 ? "subiu" : "caiu"} ${fmtPct(Math.abs(lastQ.netIncomeYoY))} sobre o mesmo trimestre do ano anterior.`);
  if (revG !== null && niG !== null && niG > revG + 0.03) outlook.push("O lucro cresceu mais rápido que a receita em 5 anos: ganho de eficiência ou de margem.");

  // ---------- resumo ----------
  // no resumo, o preço entra só pelo teto central (cada fórmula já aparece na seção Preço)
  const all = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title }))).filter((i) => !i.label.startsWith("Preço teto: "));
  const strengths = all.filter((i) => i.tone === "good").map((i) => `${i.label}: ${i.value}`);
  const concerns = all.filter((i) => i.tone === "bad").map((i) => `${i.label}: ${i.value}`);
  const score = strengths.length - concerns.length * 1.5;
  // alertas que se sobrepõem à contagem: empresa fora da operação normal ou com prejuízo recente
  const distressed = !!gov?.status && !/^fase operacional$/i.test(gov.status);
  const losing = ok(ttm?.netIncome ?? null) ? (ttm!.netIncome as number) < 0 : ok(marginNow) && marginNow < 0;
  let tone: Tone = score >= 3 && (avgMargin ?? 0) >= 0 ? "good" : score < 0 ? "bad" : "neutral";
  if (distressed) tone = "bad";
  else if (losing && tone === "good") tone = "neutral";
  if (distressed) concerns.unshift(`Empresa em situação especial na CVM: ${gov!.status}`);
  const priceText =
    avgMargin === null ? "sem preço teto calculável" : avgMargin >= 0 ? `cotação ${fmtPct(avgMargin)} abaixo do preço teto central` : `cotação ${fmtPct(-avgMargin)} acima do preço teto central`;
  const headline = distressed
    ? `Atenção: ${gov!.status!.toLowerCase()}. Números passados dizem pouco sobre o futuro nesta situação.`
    : tone === "good"
      ? `Fundamentos sólidos e ${priceText}.`
      : tone === "bad"
        ? `Pontos de atenção superam os fortes; ${priceText}.`
        : `Quadro misto; ${priceText}.`;

  return { tone, headline, strengths, concerns, fairValues, fairAverage, sections, outlook };
}
