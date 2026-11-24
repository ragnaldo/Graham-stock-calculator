import { useMemo, useState } from "react";
import { fmtNumber, fmtPct, fmtPrice } from "@/core/format";
import { findOpportunities } from "@/core/opportunities";
import type { Position } from "@/core/portfolio";
import { DEFAULT_SETTINGS, diagnose, diversifyIdeas, planRebalance, type RebalanceSettings, type Tone } from "@/core/rebalance";
import { macroSector } from "@/core/sectors";
import { assetInfo, getCompany, getStocks } from "@/web/data";
import { Card, Margin, VerdictIcon } from "./ui";

const KEY = "graham:rebalance:v1";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const toPass = (t: Tone) => (t === "good" ? true : t === "bad" ? false : null);

function loadSettings(): RebalanceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<RebalanceSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function scoreLabel(score: number) {
  return score >= 75 ? { text: "boa", cls: "text-good" } : score >= 50 ? { text: "média", cls: "text-warn" } : { text: "baixa", cls: "text-bad" };
}

/** Diversificação, balanceamento com o próximo aporte e ideias para diversificar. */
export function Rebalance({ positions, version }: { positions: Position[]; version: number }) {
  const [s, setS] = useState<RebalanceSettings>(loadSettings);
  const update = (patch: Partial<RebalanceSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // sem armazenamento: vale nesta visita
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const info = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof assetInfo>>();
    return (t: string) => cache.get(t) ?? cache.set(t, assetInfo(t)).get(t)!;
  }, [positions, version]);
  const d = useMemo(() => diagnose(positions, info), [positions, info]);
  const plan = useMemo(() => planRebalance(positions, info, s), [positions, info, s]);
  const ideas = useMemo(() => {
    const held = new Set(positions.map((p) => info(p.ticker).company));
    const opps = findOpportunities(getStocks().stocks, { minLiquidity: 1_000_000, limit: 80, statusOf: (r) => getCompany(r.ticker)?.gov?.status });
    return diversifyIdeas(opps, (o) => ({ company: o.stock.cnpj ?? o.stock.ticker.slice(0, 4), sector: macroSector(o.stock.sector) }), d, held);
  }, [positions, info, d]);

  const label = scoreLabel(d.score);
  const field = "num w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-right";

  return (
    <section aria-labelledby="balanceamento" className="mb-5">
      <h2 id="balanceamento" className="mb-3 text-lg font-semibold">
        Diversificação e balanceamento
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
        <Card title="Diversificação" className="min-w-0">
          <div className="flex items-end gap-3 px-4 pt-4">
            <span className="num text-4xl font-semibold tracking-tight">{d.score}</span>
            <span className="pb-1 text-sm text-ink-2">
              de 100 · <span className={`font-medium ${label.cls}`}>{label.text}</span>
            </span>
          </div>
          <div className="mx-4 mt-2 h-2 rounded-full bg-surface-2" aria-hidden>
            <div className="h-2 rounded-full bg-[var(--series-1)]" style={{ width: `${d.score}%` }} />
          </div>
          <ul className="mt-3 divide-y divide-line">
            {d.diagnostics.map((x) => (
              <li key={x.id} className="grid grid-cols-[1rem_1fr] gap-x-2 px-4 py-2 text-sm">
                <span className="pt-0.5">
                  <VerdictIcon pass={toPass(x.tone)} />
                </span>
                <span className="min-w-0">
                  <span className="text-ink-2">{x.label}</span>
                  <span className="block font-medium break-words">{x.value}</span>
                  {x.advice && <span className="block text-xs text-ink-3">{x.advice}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Grandes setores</h3>
            <ul className="space-y-2">
              {d.sectors.map((sec) => (
                <li key={sec.sector}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate" title={sec.tickers.join(", ")}>
                      {sec.sector}
                    </span>
                    <span className="num shrink-0 text-ink-2">{fmtPct(sec.weight)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2" aria-hidden>
                    <div className={`h-1.5 rounded-full ${sec.weight > s.maxSector ? "bg-bad" : "bg-[var(--series-1)]"}`} style={{ width: `${sec.weight * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-3">Setores da CVM agrupados por risco em comum. Em vermelho, acima do limite por setor.</p>
          </div>
        </Card>

        <Card title="Balanceamento com o próximo aporte" className="min-w-0">
          <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-2 xl:grid-cols-5">
            <label className="text-xs text-ink-2">
              Modelo
              <select id="rb-model" value={s.model} onChange={(e) => update({ model: e.target.value as RebalanceSettings["model"] })} className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm">
                <option value="equal">Pesos iguais</option>
                <option value="current">Pesos atuais</option>
              </select>
            </label>
            <label className="text-xs text-ink-2">
              Limite por empresa (%)
              <input id="rb-asset" type="number" min={1} max={100} step={1} value={Math.round(s.maxAsset * 100)} onChange={(e) => e.target.valueAsNumber > 0 && update({ maxAsset: e.target.valueAsNumber / 100 })} className={`${field} mt-1`} />
            </label>
            <label className="text-xs text-ink-2">
              Limite por setor (%)
              <input id="rb-sector" type="number" min={1} max={100} step={1} value={Math.round(s.maxSector * 100)} onChange={(e) => e.target.valueAsNumber > 0 && update({ maxSector: e.target.valueAsNumber / 100 })} className={`${field} mt-1`} />
            </label>
            <label className="text-xs text-ink-2">
              Aporte (R$)
              <input id="rb-contribution" type="number" min={0} step={100} value={s.contribution} onChange={(e) => update({ contribution: Math.max(0, e.target.valueAsNumber || 0) })} className={`${field} mt-1`} />
            </label>
            <div className="flex flex-col justify-end gap-1.5 text-xs text-ink-2">
              <label className="flex items-center gap-2">
                <input id="rb-sells" type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.allowSells} onChange={(e) => update({ allowSells: e.target.checked })} />
                Permitir vendas
              </label>
              <label className="flex items-center gap-2">
                <input id="rb-alerts" type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.skipAlerts} onChange={(e) => update({ skipAlerts: e.target.checked })} />
                Não comprar papéis em alerta
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 pt-3 text-sm">
            <span>
              Comprar <strong className="num">{brl(plan.bought)}</strong>
            </span>
            {plan.sold > 0 && (
              <span>
                Vender <strong className="num">{brl(plan.sold)}</strong>
              </span>
            )}
            <span className="text-ink-2">
              Sobra <span className="num">{brl(plan.leftover)}</span>
            </span>
          </div>
          {plan.notes.length > 0 && (
            <ul className="mx-4 mt-2 space-y-1 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-3 py-2 text-left font-medium">Papel</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Peso atual</th>
                  <th className="px-3 py-2 text-right font-medium">Alvo</th>
                  <th className="px-3 py-2 text-right font-medium">Depois</th>
                  <th className="px-3 py-2 text-left font-medium">Sugestão</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {plan.orders.map((o) => (
                  <tr key={o.ticker} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <a href={`#${o.ticker}`} className="font-semibold hover:underline">
                        {o.ticker}
                      </a>
                      <span className="block text-xs text-ink-3">{o.sector}</span>
                    </td>
                    <td className="num px-3 py-2 text-right">{fmtPct(o.currentWeight)}</td>
                    <td className="num px-3 py-2 text-right">{fmtPct(o.targetWeight)}</td>
                    <td className="num px-3 py-2 text-right">{fmtPct(o.afterWeight)}</td>
                    <td className="px-3 py-2">
                      {o.shares > 0 ? (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                          Comprar {fmtNumber(o.shares, 0)} × {fmtPrice(o.price)}
                        </span>
                      ) : o.shares < 0 ? (
                        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
                          Vender {fmtNumber(-o.shares, 0)} × {fmtPrice(o.price)}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-3">{o.note ?? "manter"}</span>
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right">{o.amount ? brl(Math.abs(o.amount)) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-xs leading-snug text-ink-3">
            Sem vendas, o aporte vai para quem está abaixo do alvo, evitando imposto e custos. Quantidades em ações inteiras pela cotação atual. Classes da mesma empresa (ON, PN, unit)
            contam juntas no limite. Sugestão por regras fixas, para estudo.
          </p>
        </Card>
      </div>

      {ideas.length > 0 && (
        <Card title="Para diversificar" aside={<span className="text-xs text-ink-3">Oportunidades da triagem em setores que a carteira não tem ou tem pouco</span>} className="mt-4">
          <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {ideas.map(({ item: o, sector, reason }) => (
              <li key={o.stock.ticker}>
                <a href={`#${o.stock.ticker}`} className="block h-full rounded-lg border border-line p-3 hover:border-accent">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{o.stock.ticker}</span>
                    <span className="num text-sm text-ink-2">{fmtPrice(o.stock.price)}</span>
                  </div>
                  <div className="truncate text-xs text-ink-3">
                    {o.stock.name} · {sector}
                  </div>
                  <p className="mt-2 text-sm">Diversifica: {reason}.</p>
                  <p className="mt-1 text-xs text-ink-2">
                    Margem pelo Nº de Graham <Margin value={o.graham.margin} /> · defensivo {o.defensive.score}/{o.defensive.maxScore}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
