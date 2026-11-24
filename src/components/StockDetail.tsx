import { useMemo, useState } from "react";
import { fmtCompact, fmtDate, fmtDateTime, fmtInt, fmtMultiple, fmtNumber, fmtPct, fmtPrice } from "@/core/format";
import { STRATEGIES, defaultParams, runStrategy, type StrategyResult } from "@/core/strategies";
import type { AnnualPoint, QuarterPoint, StockDetail as Detail } from "@/core/types";
import { useConfig } from "@/lib/useConfig";
import { getDetail, getStocks } from "@/web/data";
import { useDataVersion } from "@/web/hooks";
import { FullAnalysis } from "./FullAnalysis";
import { Chart } from "./charts";
import { Button, Card, Margin, VerdictBadge, VerdictIcon } from "./ui";

type Payload = Detail;

const RANGES = [
  { id: "5a", label: "5 anos", months: 60 },
  { id: "10a", label: "10 anos", months: 120 },
  { id: "max", label: "Máx.", months: Infinity },
] as const;

const fmtUnit = (v: number | null, unit: "brl" | "pct" | "x" | "n") =>
  unit === "pct" ? fmtPct(v) : unit === "x" ? fmtMultiple(v) : unit === "n" ? fmtInt(v) : v !== null && Math.abs(v) >= 1e4 ? fmtCompact(v) : fmtPrice(v);

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-ink-3" title={hint ?? label}>
        {label}
      </dt>
      <dd className="num mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

function StrategyCard({ name, description, result }: { name: string; description: string; result: StrategyResult }) {
  return (
    <Card
      title={name}
      aside={
        <span className="flex items-center gap-2 text-xs text-ink-2">
          {result.maxScore > 0 && (
            <span className="num">
              {result.score}/{result.maxScore} critérios
            </span>
          )}
          <VerdictBadge pass={result.pass} />
        </span>
      }
    >
      <div className="px-4 py-3">
        {result.fairValue !== null && (
          <p className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs text-ink-3">Preço teto</span>
            <span className="num text-2xl font-semibold tracking-tight">{fmtPrice(result.fairValue)}</span>
            <span className="text-sm">
              margem <Margin value={result.margin} />
            </span>
          </p>
        )}
        <ul className="space-y-2">
          {result.criteria.map((c) => (
            <li key={c.id} className="grid grid-cols-[1rem_1fr] gap-x-2 text-sm">
              <span className="pt-0.5">{c.na ? <span className="text-ink-3">·</span> : <VerdictIcon pass={c.pass} />}</span>
              <span>
                <span className="font-medium">{c.label}</span> <span className="text-ink-3">({c.target})</span>
                <span className="block text-ink-2">{c.value}</span>
                {c.note && <span className="block text-xs text-ink-3">{c.note}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-2 text-xs leading-snug text-ink-3">{description}</p>
      </div>
    </Card>
  );
}

const thousand = (v: number | null) => fmtCompact(v !== null ? v * 1000 : null, "");
const QUARTER_COLUMNS: { label: string; title?: string; get: (q: QuarterPoint) => React.ReactNode }[] = [
  { label: "Receita", get: (q) => thousand(q.revenue) },
  { label: "EBIT", get: (q) => thousand(q.ebit) },
  { label: "Lucro líq.", get: (q) => thousand(q.netIncome) },
  { label: "Lucro vs ano ant.", title: "Variação do lucro sobre o mesmo trimestre do ano anterior", get: (q) => <Margin value={q.netIncomeYoY} /> },
  { label: "Mrg. líq.", get: (q) => fmtPct(q.netMargin) },
  { label: "LPA", title: "Lucro por ação no trimestre, ajustado", get: (q) => fmtNumber(q.lpa) },
  { label: "Prov. pagos", title: "Dividendos e JCP pagos no trimestre (fluxo de caixa)", get: (q) => thousand(q.dividendsPaid) },
  { label: "Patrimônio", get: (q) => thousand(q.equity) },
  { label: "Dív. bruta", get: (q) => thousand(q.grossDebt) },
  { label: "Dív./PL", get: (q) => fmtMultiple(q.debtToEquity) },
  { label: "Liq. corr.", get: (q) => fmtMultiple(q.currentRatio) },
];

const ANNUAL_COLUMNS: { label: string; title?: string; get: (a: AnnualPoint) => string }[] = [
  { label: "Cotação", title: "Último fechamento do ano, ajustado por desdobramentos", get: (a) => fmtPrice(a.price) },
  { label: "P/L", get: (a) => fmtMultiple(a.pl) },
  { label: "P/VP", get: (a) => fmtMultiple(a.pvp) },
  { label: "DY", get: (a) => fmtPct(a.dy) },
  { label: "LPA", get: (a) => fmtNumber(a.lpa) },
  { label: "VPA", get: (a) => fmtNumber(a.vpa) },
  { label: "Prov./ação", get: (a) => fmtNumber(a.dps) },
  { label: "Payout", get: (a) => fmtPct(a.payout, 0) },
  { label: "ROE", get: (a) => fmtPct(a.roe) },
  { label: "Mrg. líq.", get: (a) => fmtPct(a.netMargin) },
  { label: "Receita", get: (a) => fmtCompact(a.revenue !== null ? a.revenue * 1000 : null, "") },
  { label: "EBIT", get: (a) => fmtCompact(a.ebit !== null ? a.ebit * 1000 : null, "") },
  { label: "Lucro líq.", get: (a) => fmtCompact(a.netIncome !== null ? a.netIncome * 1000 : null, "") },
  { label: "Patrimônio", get: (a) => fmtCompact(a.equity !== null ? a.equity * 1000 : null, "") },
  { label: "Dív. bruta", get: (a) => fmtCompact(a.grossDebt !== null ? a.grossDebt * 1000 : null, "") },
  { label: "Dív./PL", get: (a) => fmtMultiple(a.debtToEquity) },
  { label: "Liq. corr.", get: (a) => fmtMultiple(a.currentRatio) },
];

export function StockDetail({ ticker }: { ticker: string }) {
  const [config] = useConfig();
  const version = useDataVersion();
  const data = useMemo<Payload | null>(() => getDetail(ticker), [ticker, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("10a");
  const [allDividends, setAllDividends] = useState(false);

  // todas as estratégias de Graham, com os parâmetros salvos na triagem
  const analysis = useMemo(() => {
    if (!data) return [];
    return STRATEGIES.filter((s) => !s.usesRules || config.active.some((a) => a.id === s.id)).flatMap((s) => {
      const active = config.active.find((a) => a.id === s.id) ?? { id: s.id, params: defaultParams(s) };
      const result = runStrategy(data.row, active);
      return result && (!s.usesRules || result.criteria.length) ? [{ strategy: s, result }] : [];
    });
  }, [data, config]);

  const prices = useMemo(() => {
    if (!data) return [];
    const months = RANGES.find((r) => r.id === range)!.months;
    const list = Number.isFinite(months) ? data.prices.slice(-months) : data.prices;
    return list.map((p) => ({ x: p.month, close: p.close }));
  }, [data, range]);
  const yearTicks = useMemo(() => {
    const jan = prices.filter((p) => p.x.endsWith("-01")).map((p) => p.x);
    const step = Math.ceil(jan.length / 8) || 1;
    return jan.filter((_, i) => i % step === 0);
  }, [prices]);

  if (!data)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-ink-2">Papel {ticker} não encontrado na base.</p>
        <p className="mt-4">
          <a href="#" className="text-accent underline">
            Voltar à lista
          </a>
        </p>
      </div>
    );
  const quotes = getStocks();

  const { row, info, annual } = data;
  // exercícios fechados + últimos 12 meses ("12M") quando há trimestres
  const withTtm = data.ttm ? [...annual, data.ttm] : annual;
  const years = withTtm.map((a) => ({ ...a, label: null, consolidated: a.consolidated ? 1 : 0, x: a.label ? "12M" : a.year }));
  const quarterRows = data.quarters.map((q) => ({ ...q, x: q.label }));
  const money = (v: number) => fmtCompact(v * 1000, "");
  const short = (v: number) => fmtNumber(v, Math.abs(v) >= 100 ? 0 : 1);
  // eixo: sem decimais a partir de 10 unidades da escala (ex.: "45 bi")
  const moneyAxis = (v: number) => {
    const a = Math.abs(v) * 1000;
    const [div, unit] = a >= 1e9 ? [1e9, " bi"] : a >= 1e6 ? [1e6, " mi"] : a >= 1e3 ? [1e3, " mil"] : [1, ""];
    const n = (v * 1000) / div;
    return `${fmtNumber(n, Math.abs(n) >= 10 || n === 0 ? 0 : 1)}${unit}`;
  };
  const pct0 = (v: number) => fmtPct(v, 0);
  const monthLabel = (x: string | number) => {
    const [y, m] = String(x).split("-");
    return `${m}/${y}`;
  };
  const dividendRows = allDividends ? data.dividends : data.dividends.slice(0, 12);

  return (
    <div className="mx-auto max-w-[1300px] px-4 pb-16">
      <nav className="py-4 text-sm">
        <a href="#" className="text-accent hover:underline">
          ← Voltar às ações
        </a>
      </nav>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {row.ticker} <span className="text-base font-normal text-ink-2">{info.company ?? row.name}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-2">{[info.sector ?? row.sector, info.subsector, info.type].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="num text-3xl font-semibold tracking-tight">{fmtPrice(row.price)}</div>
            <div className="text-xs text-ink-3">{quotes.live ? `cotação de ${fmtDateTime(quotes.updatedAt)}` : `fechamento de ${fmtDate(info.lastQuoteDate)}`}</div>
          </div>
          <a href="#carteira" className="hidden rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 sm:inline-flex">
            Carteira
          </a>
        </div>
      </header>

      {data.warnings.length > 0 && (
        <ul role="status" className="mb-4 space-y-1 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Card className="mb-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="P/L" value={fmtMultiple(row.pl)} />
          <Stat label="P/VP" value={fmtMultiple(row.pvp)} />
          <Stat label="Dividend yield" value={fmtPct(row.dy)} />
          <Stat label="LPA" value={fmtPrice(row.lpa)} />
          <Stat label="VPA" value={fmtPrice(row.vpa)} />
          <Stat label="Valor de mercado" value={fmtCompact(info.marketCap ?? row.marketCap)} />
          <Stat label="Mín. / máx. 52 sem." value={`${fmtNumber(info.min52)} / ${fmtNumber(info.max52)}`} />
          <Stat label="Liq. diária (2m)" value={fmtCompact(info.avgVolume2m ?? row.liq2m)} />
        </dl>
      </Card>

      <FullAnalysis detail={data} results={analysis} />

      <h2 className="mb-3 text-lg font-semibold">Critérios por estratégia</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {analysis.map(({ strategy, result }) => (
          <StrategyCard key={strategy.id} name={strategy.name} description={strategy.description} result={result} />
        ))}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Indicadores atuais</h2>
      <Card className="mb-8">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.fundamentals.map((f) => (
            <Stat key={f.label} label={f.label} value={fmtUnit(f.value, f.unit)} />
          ))}
          <Stat label="Nº de ações" value={fmtCompact(info.shares, "")} />
          <Stat label="Valor da firma (EV)" value={fmtCompact(info.enterpriseValue)} />
        </dl>
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
          Último balanço processado: {fmtDate(info.lastBalanceDate)} · indicadores coletados em {fmtDateTime(data.updatedAt)}
        </p>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Histórico</h2>
        <div role="group" aria-label="Período do gráfico de cotação" className="flex gap-1 rounded-lg border border-line bg-surface p-1 text-xs">
          {RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)} className={`rounded-md px-2.5 py-1 ${range === r.id ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4">
        <Chart
          title="Cotação"
          note="fechamento mensal, ajustado por desdobramentos (sem ajuste por proventos)"
          kind="line"
          dots={false}
          height={260}
          data={prices}
          series={[{ key: "close", label: "Cotação" }]}
          format={fmtPrice}
          axisFormat={short}
          labelFormat={monthLabel}
          xTicks={yearTicks}
          xTickFormat={(x) => String(x).slice(0, 4)}
        />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Chart title="P/L" note="fim de cada ano · 12M a preço atual" kind="line" data={years} series={[{ key: "pl", label: "P/L" }]} format={fmtMultiple} axisFormat={short} />
        <Chart title="P/VP" note="fim de cada ano · 12M a preço atual" kind="line" data={years} series={[{ key: "pvp", label: "P/VP" }]} format={fmtMultiple} axisFormat={short} />
        <Chart title="Dividend yield" note="proventos do ano ÷ cotação final" kind="bar" data={years} series={[{ key: "dy", label: "DY" }]} format={fmtPct} axisFormat={pct0} />
        <Chart title="Lucro por ação (LPA)" note="R$, ajustado" kind="bar" data={years} series={[{ key: "lpa", label: "LPA" }]} format={fmtPrice} axisFormat={short} />
        <Chart title="Valor patrimonial por ação (VPA)" note="R$, ajustado" kind="bar" data={years} series={[{ key: "vpa", label: "VPA" }]} format={fmtPrice} axisFormat={short} />
        <Chart title="Proventos por ação" note="R$, ajustado" kind="bar" data={years} series={[{ key: "dps", label: "Proventos" }]} format={fmtPrice} axisFormat={short} />
        <Chart title="Receita líquida" note="R$" kind="bar" data={years} series={[{ key: "revenue", label: "Receita" }]} format={money} axisFormat={moneyAxis} />
        <Chart title="Lucro líquido" note="R$, controladores" kind="bar" data={years} series={[{ key: "netIncome", label: "Lucro" }]} format={money} axisFormat={moneyAxis} />
        <Chart
          title="Rentabilidade"
          kind="line"
          data={years}
          series={[
            { key: "roe", label: "ROE" },
            { key: "netMargin", label: "Margem líquida" },
          ]}
          format={fmtPct}
          axisFormat={pct0}
        />
      </div>

      <Card
        title="Histórico anual"
        aside={<span className="text-xs text-ink-3">Demonstrações anuais (CVM){data.ttm ? ` · ${data.ttm.label}: soma dos 4 últimos trimestres, a preço atual` : ""} · valores em R$</span>}
        className="mb-8"
      >
        {annual.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-2">Sem demonstrações anuais para este papel.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Ano</th>
                  {ANNUAL_COLUMNS.map((c) => (
                    <th key={c.label} title={c.title} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...(data.ttm ? [data.ttm] : []), ...[...annual].reverse()].map((a) => (
                  <tr key={a.label ?? a.year} className={`border-b border-line last:border-0 ${a.label ? "bg-accent-soft/40" : ""}`}>
                    <th scope="row" className={`sticky left-0 px-3 py-1.5 text-left font-medium whitespace-nowrap ${a.label ? "bg-accent-soft" : "bg-surface"}`}>
                      {a.label ?? a.year}
                    </th>
                    {ANNUAL_COLUMNS.map((c) => (
                      <td key={c.label} className="num px-3 py-1.5 text-right whitespace-nowrap">
                        {c.get(a)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data.quarters.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-semibold">Resultados trimestrais</h2>
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Chart title="Lucro líquido por trimestre" note="R$, 3 meses" kind="bar" data={quarterRows} series={[{ key: "netIncome", label: "Lucro" }]} format={money} axisFormat={moneyAxis} />
            <Chart title="Receita líquida por trimestre" note="R$, 3 meses" kind="bar" data={quarterRows} series={[{ key: "revenue", label: "Receita" }]} format={money} axisFormat={moneyAxis} />
          </div>
          <Card title="Trimestres" aside={<span className="text-xs text-ink-3">ITR (CVM) · 4º trimestre = ano menos 9 meses · valores em R$</span>} className="mb-8">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-2">
                    <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Trimestre</th>
                    {QUARTER_COLUMNS.map((c) => (
                      <th key={c.label} title={c.title} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...data.quarters].reverse().map((q) => (
                    <tr key={q.date} className="border-b border-line last:border-0">
                      <th scope="row" className="sticky left-0 bg-surface px-3 py-1.5 text-left font-medium">
                        {q.label}
                      </th>
                      {QUARTER_COLUMNS.map((c) => (
                        <td key={c.label} className="num px-3 py-1.5 text-right whitespace-nowrap">
                          {c.get(q)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <h2 className="mb-3 text-lg font-semibold">Proventos</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Chart
          title="Proventos por ação por ano"
          note="dividendos + JCP, data com, ajustado"
          kind="bar"
          height={240}
          data={data.dividendsByYear.slice(-16).map((d) => ({ x: d.year, value: d.value }))}
          series={[{ key: "value", label: "Proventos" }]}
          format={fmtPrice}
          axisFormat={short}
        />
        <Card title="Últimos proventos">
          {data.dividends.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-2">Sem proventos registrados.</p>
          ) : (
            <>
              <div className="max-h-[17rem] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-2">
                      <th className="px-3 py-2 text-left font-medium">Data com</th>
                      <th className="px-3 py-2 text-left font-medium">Tipo</th>
                      <th className="px-3 py-2 text-right font-medium">R$/ação</th>
                      <th className="px-3 py-2 text-right font-medium">Pagamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendRows.map((d, i) => (
                      <tr key={`${d.date}-${i}`} className="border-b border-line last:border-0">
                        <td className="num px-3 py-1.5">{fmtDate(d.date)}</td>
                        <td className="px-3 py-1.5 text-ink-2">{d.type}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtNumber(d.value, 4)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink-2">{fmtDate(d.payDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.dividends.length > 12 && (
                <div className="border-t border-line px-3 py-2">
                  <Button variant="ghost" onClick={() => setAllDividends((v) => !v)}>
                    {allDividends ? "Mostrar menos" : `Ver todos (${data.dividends.length})`}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {data.splits.length > 0 && (
        <p className="mt-4 text-xs text-ink-3">
          Desdobramentos/grupamentos considerados:{" "}
          {data.splits.map((s) => `${fmtDate(s.date)} (${s.factor >= 1 ? `1 → ${fmtNumber(s.factor, s.factor % 1 ? 2 : 0)}` : `${fmtNumber(1 / s.factor, (1 / s.factor) % 1 ? 2 : 0)} → 1`})`).join(", ")}.
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-ink-3">
        Indicadores atuais e proventos: Fundamentus. Histórico anual: demonstrações financeiras padronizadas (CVM). Cotações históricas: B3. Valores por ação do histórico usam as ações em circulação de cada ano, trazidas à base
        atual. Ferramenta de estudo; não é recomendação de investimento.
      </p>
    </div>
  );
}
