import { useMemo, useState } from "react";
import { fmtCompact, fmtMultiple, fmtPct, fmtPrice } from "@/core/format";
import { findOpportunities } from "@/core/opportunities";
import { getCompany, getStocks } from "@/web/data";
import { useDataVersion } from "@/web/hooks";
import { Margin, VerdictIcon } from "./ui";

const LIQUIDITY = [
  { value: 500_000, label: "R$ 500 mil" },
  { value: 1_000_000, label: "R$ 1 mi" },
  { value: 5_000_000, label: "R$ 5 mi" },
  { value: 20_000_000, label: "R$ 20 mi" },
];

export function Opportunities() {
  const version = useDataVersion();
  const [minLiquidity, setMinLiquidity] = useState(1_000_000);
  const list = useMemo(
    () => findOpportunities(getStocks().stocks, { minLiquidity, limit: 18, statusOf: (s) => getCompany(s.ticker)?.gov?.status }),
    [minLiquidity, version], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3 py-5">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold tracking-tight">Oportunidades para estudo</h1>
          <p className="mt-1 text-sm text-ink-2">
            Empresas lucrativas (ROE ≥ 8%), em operação normal, com cotação ao menos 15% abaixo do Número de Graham ou 10% abaixo do teto de Bazin, e que passam em 4 ou mais dos 7
            critérios do investidor defensivo. Ordenadas por uma nota que soma margem de segurança, critérios de Graham, dividendos, ROE e dívida.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Liquidez diária mínima
          <select id="opp-liquidity" value={minLiquidity} onChange={(e) => setMinLiquidity(Number(e.target.value))} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink">
            {LIQUIDITY.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {list.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-10 text-center text-sm text-ink-2">Nenhuma empresa passa nesses critérios hoje. Reduza a liquidez mínima.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((o, i) => {
            const s = o.stock;
            return (
              <li key={s.ticker}>
                <a href={`#${s.ticker}`} className="group flex h-full flex-col rounded-xl border border-line bg-surface p-4 transition hover:border-accent hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="num text-xs text-ink-3">{i + 1}º</span>
                        <span className="text-lg font-semibold">{s.ticker}</span>
                        <span className="num text-sm text-ink-2">{fmtPrice(s.price)}</span>
                      </div>
                      <div className="truncate text-xs text-ink-3">
                        {s.name} · {s.sector}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] text-ink-3">nota</div>
                      <div className="num text-lg font-semibold">{Math.round(o.score * 100)}</div>
                    </div>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2" aria-hidden>
                    <div className="h-1.5 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.round(o.score * 100)}%` }} />
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] text-ink-3">Nº de Graham</dt>
                      <dd className="num">{fmtPrice(o.graham.fairValue)}</dd>
                      <dd className="text-xs">
                        <Margin value={o.graham.margin} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-3">Teto Bazin</dt>
                      <dd className="num">{fmtPrice(o.bazin.fairValue)}</dd>
                      <dd className="text-xs">
                        <Margin value={o.bazin.margin} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-3">Defensivo</dt>
                      <dd className="num flex items-center gap-1">
                        <VerdictIcon pass={o.defensive.pass} />
                        {o.defensive.score}/{o.defensive.maxScore}
                      </dd>
                    </div>
                  </dl>

                  <ul className="mt-3 flex-1 space-y-1 text-sm text-ink-2">
                    {o.reasons.map((r) => (
                      <li key={r} className="flex gap-2">
                        <VerdictIcon pass={true} />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-3">
                    <span>
                      P/L {fmtMultiple(s.pl)} · P/VP {fmtMultiple(s.pvp)} · DY {fmtPct(s.dy)} · liq. {fmtCompact(s.liq2m)}
                    </span>
                    <span className="font-medium text-accent group-hover:underline">Análise completa →</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-3">
        Lista gerada por regras fixas sobre os dados coletados, para estudo. Não é recomendação de investimento: confira a análise completa e os documentos de cada empresa. DY muito alto
        costuma vir de dividendo extraordinário e não se repetir.
      </p>
    </div>
  );
}
