import { useMemo } from "react";
import { analyze, type Tone } from "@/core/analysis";
import { fmtDate, fmtPrice } from "@/core/format";
import type { Strategy, StrategyResult } from "@/core/strategies";
import type { StockDetail } from "@/core/types";
import { Card, Margin, VerdictIcon } from "./ui";

const toPass = (t: Tone) => (t === "good" ? true : t === "bad" ? false : null);
const TONE_LABEL: Record<Tone, string> = { good: "Favorável", neutral: "Misto", bad: "Desfavorável" };
const TONE_CLS: Record<Tone, string> = { good: "bg-good-soft text-good", neutral: "bg-surface-2 text-ink-2", bad: "bg-bad-soft text-bad" };

function ToneBadge({ tone }: { tone: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLS[tone]}`}>
      <VerdictIcon pass={toPass(tone)} />
      {TONE_LABEL[tone]}
    </span>
  );
}

const pct = (x: number) => `${x.toFixed(1).replace(".", ",")}%`;

export function FullAnalysis({ detail, results }: { detail: StockDetail; results: { strategy: Strategy; result: StrategyResult }[] }) {
  const a = useMemo(() => analyze(detail, results), [detail, results]);
  const gov = detail.gov;
  const margin = a.fairAverage ? 1 - detail.row.price / a.fairAverage : null;
  const docs = gov?.docs ?? [];

  return (
    <section aria-labelledby="analise" className="mb-8">
      <h2 id="analise" className="mb-3 text-lg font-semibold">
        Análise completa
      </h2>

      <Card className="mb-4">
        <div className="grid gap-5 p-4 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <ToneBadge tone={a.tone} />
            <p className="mt-2 text-base font-medium text-balance">{a.headline}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">Pontos fortes</h3>
                {a.strengths.length ? (
                  <ul className="space-y-1 text-sm">
                    {a.strengths.slice(0, 7).map((s) => (
                      <li key={s} className="flex gap-2">
                        <VerdictIcon pass={true} />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">Nenhum destaque positivo nos critérios.</p>
                )}
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">Pontos de atenção</h3>
                {a.concerns.length ? (
                  <ul className="space-y-1 text-sm">
                    {a.concerns.slice(0, 7).map((s) => (
                      <li key={s} className="flex gap-2">
                        <VerdictIcon pass={false} />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">Nenhum ponto negativo nos critérios.</p>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-lg bg-surface-2 p-4 md:w-60">
            <div className="text-xs text-ink-3">Preço teto central</div>
            <div className="num mt-1 text-3xl font-semibold tracking-tight">{fmtPrice(a.fairAverage)}</div>
            <div className="mt-1 text-sm">
              margem <Margin value={margin} />
            </div>
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-ink-2">
              {a.fairValues.map((f) => (
                <li key={f.name} className="flex justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span className="num">{fmtPrice(f.value)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-snug text-ink-3">Mediana dos preços teto das estratégias, para reduzir o peso de uma fórmula muito otimista.</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {a.sections.map((sec) => (
          <Card key={sec.id} title={sec.title} aside={<ToneBadge tone={sec.tone} />}>
            <ul className="divide-y divide-line">
              {sec.items.map((i) => (
                <li key={i.label} className="grid grid-cols-[1rem_1fr] gap-x-2 px-4 py-2 text-sm">
                  <span className="pt-0.5">
                    <VerdictIcon pass={toPass(i.tone)} />
                  </span>
                  <span className="min-w-0">
                    <span className="text-ink-2">{i.label}</span>
                    <span className="num block font-medium break-words">{i.value}</span>
                    {i.note && <span className="block text-xs text-ink-3">{i.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {sec.id === "gov" && gov?.holders && gov.holders.top.length > 0 && (
              <div className="border-t border-line px-4 py-3">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Maiores acionistas</h3>
                <ul className="space-y-1.5 text-sm">
                  {gov.holders.top.map((h) => (
                    <li key={h.name + h.pct}>
                      <div className="flex justify-between gap-2">
                        <span className="min-w-0 truncate" title={h.name}>
                          {h.name}
                          {h.controller && <span className="ml-1.5 rounded bg-accent-soft px-1 text-[11px] text-accent">controlador</span>}
                        </span>
                        <span className="num shrink-0">{pct(h.pct)}</span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-surface-2">
                        <div className="h-1.5 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.min(100, h.pct)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-3">
                  Grupo controlador {gov.holders.controlPct !== null ? pct(gov.holders.controlPct) : "–"} · formulário de referência de {fmtDate(gov.holders.date)}. Pessoas físicas aparecem agrupadas.
                </p>
              </div>
            )}
          </Card>
        ))}

        <Card title="Perspectivas e documentos" className="md:col-span-2 xl:col-span-3">
          <div className="grid gap-5 p-4 lg:grid-cols-2">
            <div className="min-w-0">
              {gov?.about && (
                <>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Atividade (cadastro na CVM)</h3>
                  <p className="mb-4 text-sm">{gov.about}</p>
                </>
              )}
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">O que os números indicam</h3>
              {a.outlook.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {a.outlook.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">Sem histórico suficiente para tendências.</p>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Planos da empresa: onde ler</h3>
              <p className="mb-2 text-sm text-ink-2">
                Projeções, investimentos planejados e estratégia estão no relatório da administração (junto à DFP), nos releases de resultados e na seção “Comentários dos diretores” do
                formulário de referência. Esta página não interpreta esses textos.
              </p>
              <ul className="space-y-1.5 text-sm">
                {gov?.site && (
                  <li>
                    <a className="text-accent underline" href={gov.site} target="_blank" rel="noreferrer">
                      Site de relações com investidores
                    </a>
                  </li>
                )}
                {docs.map((d) => (
                  <li key={d.kind}>
                    <a className="text-accent underline" href={d.link} target="_blank" rel="noreferrer">
                      {d.kind === "DFP" ? `Demonstrações anuais (DFP) de ${d.date.slice(0, 4)}` : `Último balanço trimestral (ITR) de ${fmtDate(d.date)}`}
                    </a>
                    <span className="text-ink-3"> · arquivo na CVM</span>
                  </li>
                ))}
                {!gov?.site && !docs.length && <li className="text-ink-3">Sem links cadastrados.</li>}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
