// Diversificação e balanceamento da carteira: diagnóstico, pesos-alvo com limites e ordens sugeridas.
// Regras fixas para estudo; não é recomendação de investimento.
import { fmtPct } from "./format";
import type { Position } from "./portfolio";

export type Tone = "good" | "neutral" | "bad";

export interface AssetInfo {
  ticker: string;
  /** Empresa (mesmo CNPJ = mesmo risco, mesmo com classes diferentes). */
  company: string;
  sector: string;
  price: number | null;
  /** Controle estatal (risco de interferência política). */
  state: boolean;
  /** Volume médio diário (R$). */
  liquidity: number | null;
  /** Motivo para não comprar mais (prejuízo, recuperação judicial...), quando houver. */
  alert: string | null;
}

export interface Diagnostic {
  id: string;
  label: string;
  value: string;
  tone: Tone;
  advice?: string;
}

export interface Diversification {
  /** 0 a 100. */
  score: number;
  /** Número efetivo de ativos: 1 / Σ peso². Mostra quantos ativos de mesmo peso a carteira equivale. */
  effectiveAssets: number;
  effectiveSectors: number;
  diagnostics: Diagnostic[];
  companies: { company: string; tickers: string[]; weight: number }[];
  sectors: { sector: string; weight: number; tickers: string[] }[];
}

export interface RebalanceSettings {
  /** equal = pesos iguais por empresa; current = mantém os pesos atuais, só aplicando os limites. */
  model: "equal" | "current";
  /** Limite por empresa, em fração (0,15 = 15%). */
  maxAsset: number;
  /** Limite por setor, em fração. */
  maxSector: number;
  /** Valor novo a investir (R$). */
  contribution: number;
  /** Permite vender o que passou do alvo. */
  allowSells: boolean;
  /** Não compra papéis com alerta. */
  skipAlerts: boolean;
}

export const DEFAULT_SETTINGS: RebalanceSettings = { model: "equal", maxAsset: 0.15, maxSector: 0.35, contribution: 1000, allowSells: false, skipAlerts: true };

export interface Order {
  ticker: string;
  sector: string;
  price: number | null;
  currentValue: number;
  currentWeight: number;
  targetWeight: number;
  targetValue: number;
  /** Ações a comprar (positivo) ou vender (negativo). */
  shares: number;
  amount: number;
  /** Peso depois das ordens. */
  afterWeight: number;
  note?: string;
}

export interface RebalancePlan {
  orders: Order[];
  bought: number;
  sold: number;
  /** Aporte que sobra por não dar para comprar uma ação inteira. */
  leftover: number;
  notes: string[];
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const pct = (x: number) => fmtPct(x, 0);

export function diagnose(positions: Position[], info: (t: string) => AssetInfo): Diversification {
  const total = sum(positions.map((p) => p.value));
  const w = (p: Position) => (total > 0 ? p.value / total : 0);

  // por empresa (PETR3 + PETR4 contam juntas) e por setor
  const byCompany = new Map<string, { tickers: string[]; weight: number }>();
  const bySector = new Map<string, { tickers: string[]; weight: number }>();
  for (const p of positions) {
    const i = info(p.ticker);
    const c = byCompany.get(i.company) ?? { tickers: [], weight: 0 };
    c.tickers.push(p.ticker);
    c.weight += w(p);
    byCompany.set(i.company, c);
    const s = bySector.get(i.sector) ?? { tickers: [], weight: 0 };
    s.tickers.push(p.ticker);
    s.weight += w(p);
    bySector.set(i.sector, s);
  }
  const companies = [...byCompany.entries()].map(([company, v]) => ({ company, ...v })).sort((a, b) => b.weight - a.weight);
  const sectors = [...bySector.entries()].map(([sector, v]) => ({ sector, ...v })).sort((a, b) => b.weight - a.weight);
  const effectiveAssets = companies.length ? 1 / sum(companies.map((c) => c.weight ** 2)) : 0;
  const effectiveSectors = sectors.length ? 1 / sum(sectors.map((s) => s.weight ** 2)) : 0;

  const d: Diagnostic[] = [];
  const n = companies.length;
  d.push({
    id: "count",
    label: "Empresas na carteira",
    value: `${n}`,
    tone: n >= 10 ? "good" : n >= 6 ? "neutral" : "bad",
    advice: n < 6 ? "Com menos de 6 empresas, um problema em uma delas pesa muito. Graham sugeria de 10 a 30." : n < 10 ? "Entre 10 e 20 empresas já reduz bem o risco de uma só." : undefined,
  });
  d.push({
    id: "effective",
    label: "Número efetivo de ativos",
    value: effectiveAssets.toFixed(1).replace(".", ","),
    tone: effectiveAssets >= 8 ? "good" : effectiveAssets >= 5 ? "neutral" : "bad",
    advice: effectiveAssets < n * 0.7 ? `Os pesos estão desiguais: as ${n} empresas valem por ${effectiveAssets.toFixed(1).replace(".", ",")} de mesmo peso.` : undefined,
  });
  const top = companies[0];
  if (top)
    d.push({
      id: "top",
      label: "Maior posição",
      value: `${top.tickers.join(" + ")}: ${pct(top.weight)}`,
      tone: top.weight <= 0.15 ? "good" : top.weight <= 0.25 ? "neutral" : "bad",
      advice: top.weight > 0.15 ? "Acima de 15% em uma só empresa, uma queda forte dela derruba a carteira." : undefined,
    });
  const topSector = sectors[0];
  if (topSector)
    d.push({
      id: "sector",
      label: "Setor com maior peso",
      value: `${topSector.sector}: ${pct(topSector.weight)}`,
      tone: topSector.weight <= 0.3 ? "good" : topSector.weight <= 0.45 ? "neutral" : "bad",
      advice: topSector.weight > 0.3 ? "Empresas do mesmo setor costumam cair juntas (juros, preço de commodity, regulação)." : undefined,
    });
  d.push({
    id: "sectors",
    label: "Setores diferentes",
    value: `${sectors.length} (efetivos ${effectiveSectors.toFixed(1).replace(".", ",")})`,
    tone: sectors.length >= 5 ? "good" : sectors.length >= 3 ? "neutral" : "bad",
  });
  const multi = companies.filter((c) => c.tickers.length > 1);
  if (multi.length)
    d.push({
      id: "classes",
      label: "Mesma empresa em mais de um papel",
      value: multi.map((c) => c.tickers.join(" + ")).join("; "),
      tone: "neutral",
      advice: "ON, PN e units da mesma empresa têm o mesmo risco: contam juntas no limite por ativo.",
    });
  const stateW = sum(positions.filter((p) => info(p.ticker).state).map(w));
  if (stateW > 0)
    d.push({
      id: "state",
      label: "Peso em estatais",
      value: pct(stateW),
      tone: stateW <= 0.25 ? "neutral" : "bad",
      advice: stateW > 0.25 ? "Estatais podem mudar dividendos e preços por decisão do governo." : undefined,
    });
  const illiquid = positions.filter((p) => (info(p.ticker).liquidity ?? 0) < 1_000_000);
  if (illiquid.length)
    d.push({
      id: "liquidity",
      label: "Pouca liquidez (menos de R$ 1 mi por dia)",
      value: illiquid.map((p) => p.ticker).join(", "),
      tone: "neutral",
      advice: "Pode ser difícil vender sem mexer no preço.",
    });
  const flagged = positions.filter((p) => info(p.ticker).alert);
  if (flagged.length)
    d.push({
      id: "alerts",
      label: "Para revisar",
      value: flagged.map((p) => `${p.ticker} (${info(p.ticker).alert})`).join("; "),
      tone: "bad",
      advice: "O balanceamento não sugere novas compras desses papéis enquanto o alerta valer.",
    });

  // nota: quantidade, equilíbrio entre empresas e entre setores, concentração máxima
  const score =
    n === 0
      ? 0
      : Math.round(
          25 * Math.min(1, n / 12) +
            25 * Math.min(1, effectiveAssets / 10) +
            25 * Math.min(1, effectiveSectors / 6) +
            25 * Math.max(0, 1 - Math.max(0, (top?.weight ?? 0) - 0.1) / 0.3),
        );
  return { score, effectiveAssets, effectiveSectors, diagnostics: d, companies, sectors };
}

/**
 * Pesos-alvo por papel: parte do modelo (iguais por empresa ou atuais) e aplica os limites por empresa e
 * por setor, redistribuindo o excesso entre quem ainda cabe.
 */
export function targetWeights(positions: Position[], info: (t: string) => AssetInfo, s: RebalanceSettings): { weights: Map<string, number>; notes: string[] } {
  const notes: string[] = [];
  const total = sum(positions.map((p) => p.value));
  // base por empresa
  const companies = new Map<string, Position[]>();
  for (const p of positions) companies.set(info(p.ticker).company, [...(companies.get(info(p.ticker).company) ?? []), p]);
  const names = [...companies.keys()];
  const base = new Map<string, number>(
    names.map((c) => [c, s.model === "equal" ? 1 / names.length : total > 0 ? sum(companies.get(c)!.map((p) => p.value)) / total : 1 / names.length]),
  );
  const sectorOf = (c: string) => info(companies.get(c)![0].ticker).sector;

  let maxAsset = s.maxAsset;
  if (names.length * maxAsset < 1) {
    notes.push(`Com ${names.length} empresas não dá para respeitar o limite de ${pct(maxAsset)} em cada; o limite foi ignorado. Adicione empresas para diversificar.`);
    maxAsset = 1;
  }
  const sectorCount = new Set(names.map(sectorOf)).size;
  let maxSector = s.maxSector;
  if (sectorCount * maxSector < 1) {
    notes.push(`Com ${sectorCount} setores não dá para respeitar o limite de ${pct(maxSector)} por setor; o limite foi ignorado.`);
    maxSector = 1;
  }

  // redistribuição iterativa com os dois limites
  const w = new Map(base);
  for (let iter = 0; iter < 50; iter++) {
    let excess = 0;
    const capped = new Set<string>();
    for (const [c, v] of w) {
      if (v > maxAsset + 1e-12) {
        excess += v - maxAsset;
        w.set(c, maxAsset);
      }
      if (w.get(c)! >= maxAsset - 1e-12) capped.add(c);
    }
    const secTotals = new Map<string, number>();
    for (const [c, v] of w) secTotals.set(sectorOf(c), (secTotals.get(sectorOf(c)) ?? 0) + v);
    for (const [sec, tot] of secTotals) {
      if (tot > maxSector + 1e-12) {
        const k = maxSector / tot;
        for (const [c, v] of w) if (sectorOf(c) === sec) {
          excess += v - v * k;
          w.set(c, v * k);
        }
      }
      if ((secTotals.get(sec) ?? 0) >= maxSector - 1e-12) for (const c of names) if (sectorOf(c) === sec) capped.add(c);
    }
    if (excess < 1e-9) break;
    const open = names.filter((c) => !capped.has(c));
    const room = sum(open.map((c) => w.get(c)!));
    if (!open.length) {
      notes.push("Os limites somados não chegam a 100%; parte do valor ficou acima deles.");
      break;
    }
    for (const c of open) w.set(c, w.get(c)! + excess * (room > 0 ? w.get(c)! / room : 1 / open.length));
  }

  // divide o peso da empresa entre seus papéis, na proporção atual
  const weights = new Map<string, number>();
  for (const [c, list] of companies) {
    const cv = sum(list.map((p) => p.value));
    for (const p of list) weights.set(p.ticker, w.get(c)! * (cv > 0 ? p.value / cv : 1 / list.length));
  }
  return { weights, notes };
}

/** Ordens para levar a carteira em direção aos pesos-alvo usando o aporte (e vendas, se permitido). */
export function planRebalance(positions: Position[], info: (t: string) => AssetInfo, s: RebalanceSettings): RebalancePlan {
  const { weights, notes } = targetWeights(positions, info, s);
  const current = sum(positions.map((p) => p.value));
  const finalTotal = current + Math.max(0, s.contribution);
  const eligible = (p: Position) => info(p.ticker).price !== null && (!s.skipAlerts || !info(p.ticker).alert);

  const rows = positions.map((p) => {
    const target = weights.get(p.ticker)! * finalTotal;
    return { p, target, gap: target - p.value };
  });

  // valor a comprar por papel: distribui o aporte pelos que estão abaixo do alvo
  const buy = new Map<string, number>();
  const sell = new Map<string, number>();
  let cash = Math.max(0, s.contribution);
  if (s.allowSells) {
    for (const r of rows) {
      if (r.gap < 0) sell.set(r.p.ticker, -r.gap);
    }
    cash += sum([...sell.values()]);
  }
  const under = rows.filter((r) => r.gap > 0 && eligible(r.p));
  const need = sum(under.map((r) => r.gap));
  // primeiro completa quem está abaixo do alvo (proporcional à falta); o que sobrar segue os pesos-alvo
  for (const r of under) buy.set(r.p.ticker, need > cash ? (cash * r.gap) / need : r.gap);
  const extra = cash - Math.min(cash, need);
  if (extra > 0) {
    // sobra (papel em alerta não recebe a parte dele): vai para quem estava abaixo do alvo; se ninguém, para todos
    const below = rows.filter((r) => eligible(r.p) && r.gap > 0);
    const el = below.length ? below : rows.filter((r) => eligible(r.p));
    const tw = sum(el.map((r) => weights.get(r.p.ticker)!));
    for (const r of el) buy.set(r.p.ticker, (buy.get(r.p.ticker) ?? 0) + (tw > 0 ? (extra * weights.get(r.p.ticker)!) / tw : 0));
  }

  // em ações inteiras
  let bought = 0;
  let sold = 0;
  const orders: Order[] = rows.map((r) => {
    const price = info(r.p.ticker).price;
    let shares = 0;
    if (price) {
      const b = buy.get(r.p.ticker) ?? 0;
      const v = sell.get(r.p.ticker) ?? 0;
      if (b > 0) shares = Math.floor(b / price);
      else if (v > 0) shares = -Math.min(Math.floor(v / price), Math.floor(r.p.qty));
    }
    const amount = price ? shares * price : 0;
    if (amount > 0) bought += amount;
    else sold -= amount;
    const i = info(r.p.ticker);
    return {
      ticker: r.p.ticker,
      sector: i.sector,
      price,
      currentValue: r.p.value,
      currentWeight: current > 0 ? r.p.value / current : 0,
      targetWeight: weights.get(r.p.ticker)!,
      targetValue: r.target,
      shares,
      amount,
      afterWeight: 0,
      note: i.alert && s.skipAlerts && r.gap > 0 ? `sem compra: ${i.alert}` : price === null ? "sem cotação" : undefined,
    };
  });

  // segunda volta: com o que sobrou, compra 1 ação dos mais abaixo do alvo que couberem
  let leftover = Math.max(0, s.contribution) + sold - bought;
  for (let guard = 0; guard < 500 && leftover > 0; guard++) {
    const after = sum(orders.map((o) => o.currentValue + o.amount));
    const cand = orders
      .filter((o) => o.price !== null && o.price <= leftover && eligible(positions.find((p) => p.ticker === o.ticker)!))
      .map((o) => ({ o, gap: o.targetWeight * (after + leftover) - (o.currentValue + o.amount) }))
      .filter((x) => x.gap > 0)
      .sort((a, b) => b.gap - a.gap)[0];
    if (!cand) break;
    cand.o.shares += 1;
    cand.o.amount += cand.o.price!;
    bought += cand.o.price!;
    leftover -= cand.o.price!;
  }

  const finalValue = sum(orders.map((o) => o.currentValue + o.amount));
  for (const o of orders) o.afterWeight = finalValue > 0 ? (o.currentValue + o.amount) / finalValue : 0;
  if (sold > 20_000) notes.push("Vendas de ações acima de R$ 20 mil no mês pagam 15% de imposto sobre o lucro. Considere rebalancear só com aportes.");
  return { orders: orders.sort((a, b) => b.amount - a.amount), bought, sold, leftover: Math.max(0, leftover), notes };
}

export interface Idea<T> {
  item: T;
  sector: string;
  reason: string;
}

/**
 * Ideias para diversificar: candidatos (já ordenados do melhor para o pior) de grandes setores que a carteira
 * não tem ou tem pouco, sem repetir empresas da carteira e no máximo `perSector` por setor.
 */
export function diversifyIdeas<T>(
  candidates: T[],
  describe: (c: T) => { company: string; sector: string },
  d: Diversification,
  heldCompanies: Set<string>,
  opts: { limit: number; perSector: number; lowWeight: number } = { limit: 6, perSector: 2, lowWeight: 0.1 },
): Idea<T>[] {
  const weightOf = new Map(d.sectors.map((s) => [s.sector, s.weight]));
  const scored = candidates
    .map((item, rank) => ({ item, rank, ...describe(item) }))
    .filter((c) => !heldCompanies.has(c.company))
    .map((c) => ({ ...c, w: weightOf.get(c.sector) ?? 0 }))
    .filter((c) => c.w < opts.lowWeight && !/^(outros|holdings e outros)$/i.test(c.sector)); // grupos genéricos não diversificam
  // setores ausentes primeiro, depois os de menor peso; dentro do setor, a ordem dos candidatos
  scored.sort((a, b) => (a.w === 0) !== (b.w === 0) ? (a.w === 0 ? -1 : 1) : a.w - b.w || a.rank - b.rank);
  const per = new Map<string, number>();
  const out: Idea<T>[] = [];
  for (const c of scored) {
    if ((per.get(c.sector) ?? 0) >= opts.perSector) continue;
    per.set(c.sector, (per.get(c.sector) ?? 0) + 1);
    out.push({ item: c.item, sector: c.sector, reason: c.w === 0 ? `a carteira não tem ${c.sector.toLowerCase()}` : `${c.sector} tem só ${pct(c.w)} da carteira` });
    if (out.length >= opts.limit) break;
  }
  return out;
}
