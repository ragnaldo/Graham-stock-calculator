import { useMemo, useState } from "react";
import { fmtCompact, fmtDateTime, fmtMultiple, fmtPct, fmtPrice } from "@/core/format";
import { getStrategy, screen, type Evaluated, type ScreenConfig } from "@/core/strategies";
import { quarterLabel } from "@/core/history";
import { useConfig } from "@/lib/useConfig";
import { getStocks, refreshAll } from "@/web/data";
import { StrategyPanel } from "./StrategyPanel";
import { Button, Margin, Spinner, VerdictIcon } from "./ui";

type Payload = ReturnType<typeof getStocks>;

interface Column {
  id: string;
  label: string;
  title?: string;
  align?: "left";
  hideSm?: boolean;
  value: (e: Evaluated) => number | string | null;
  render: (e: Evaluated) => React.ReactNode;
}

const BASE_COLUMNS: Column[] = [
  { id: "price", label: "Cotação", value: (e) => e.stock.price, render: (e) => fmtPrice(e.stock.price) },
  { id: "pl", label: "P/L", value: (e) => e.stock.pl, render: (e) => fmtMultiple(e.stock.pl) },
  { id: "pvp", label: "P/VP", value: (e) => e.stock.pvp, render: (e) => fmtMultiple(e.stock.pvp) },
  { id: "dy", label: "DY", title: "Dividend yield (12 meses)", value: (e) => e.stock.dy, render: (e) => fmtPct(e.stock.dy) },
  { id: "roe", label: "ROE", hideSm: true, value: (e) => e.stock.roe, render: (e) => fmtPct(e.stock.roe) },
  { id: "liq", label: "Liq. diária", title: "Volume financeiro médio diário (2 meses)", hideSm: true, value: (e) => e.stock.liq2m, render: (e) => fmtCompact(e.stock.liq2m) },
];

function strategyColumns(config: ScreenConfig): Column[] {
  const cols: Column[] = [];
  for (const a of config.active) {
    const s = getStrategy(a.id);
    if (!s) continue;
    for (const kind of s.columns) {
      if (kind === "fair")
        cols.push({ id: `${s.id}:fair`, label: `Teto ${s.short}`, title: `Preço teto — ${s.name}`, value: (e) => e.results[s.id]?.fairValue ?? null, render: (e) => fmtPrice(e.results[s.id]?.fairValue) });
      else if (kind === "margin")
        cols.push({ id: `${s.id}:margin`, label: "Margem", title: `Margem de segurança — ${s.name}`, value: (e) => e.results[s.id]?.margin ?? null, render: (e) => <Margin value={e.results[s.id]?.margin ?? null} /> });
      else
        cols.push({
          id: `${s.id}:score`,
          label: s.short,
          title: `Critérios atendidos — ${s.name}`,
          value: (e) => (e.results[s.id] ? e.results[s.id].score / Math.max(1, e.results[s.id].maxScore) : null),
          render: (e) => {
            const r = e.results[s.id];
            return r ? (
              <span className="inline-flex items-center justify-end gap-1">
                <VerdictIcon pass={r.pass} />
                <span className="num">
                  {r.score}/{r.maxScore}
                </span>
              </span>
            ) : (
              "–"
            );
          },
        });
    }
  }
  return cols;
}

export function Screener() {
  const [config, setConfig] = useConfig();
  const [data, setData] = useState<Payload>(getStocks);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setWarning(null);
    try {
      const r = await refreshAll();
      setData(getStocks());
      setNotice(r.message);
      setWarning(r.warning);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const evaluated = useMemo(() => screen(data.stocks, config), [data, config]);
  const sectors = useMemo(() => [...new Set(evaluated.map((e) => e.stock.sector).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b)), [evaluated]);
  const columns = useMemo(() => [...BASE_COLUMNS, ...strategyColumns(config)], [config]);
  const passed = evaluated.filter((e) => e.pass).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = evaluated.filter((e) => (config.showFailed || e.pass) && (!sector || e.stock.sector === sector));
    if (q) list = list.filter((e) => e.stock.ticker.toLowerCase().includes(q) || (e.stock.name ?? "").toLowerCase().includes(q));
    // padrão: maior margem (ou pontuação) da primeira estratégia com coluna
    const fallback = columns.find((c) => c.id.endsWith(":margin")) ?? columns.find((c) => c.id.endsWith(":score"));
    const active = sort ?? (fallback ? { id: fallback.id, dir: -1 as const } : { id: "liq", dir: -1 as const });
    const col = active.id === "ticker" ? null : columns.find((c) => c.id === active.id);
    const val = (e: Evaluated) => (col ? col.value(e) : e.stock.ticker);
    return [...list].sort((a, b) => {
      if (a.pass !== b.pass) return a.pass ? -1 : 1;
      const x = val(a);
      const y = val(b);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * active.dir;
    });
  }, [evaluated, config.showFailed, sector, query, sort, columns]);

  const sortBy = (id: string) => setSort((s) => (s?.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: id === "ticker" ? 1 : -1 }));
  const arrow = (id: string) => (sort?.id === id ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calculadora Graham · B3</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {data.live ? `Cotações ao vivo de ${fmtDateTime(data.updatedAt)} · fundamentos de ${fmtDateTime(data.baseAt)}` : `Cotações e fundamentos de ${fmtDateTime(data.updatedAt)}`}
            {data.lastQuarter ? ` · balanços até ${quarterLabel(data.lastQuarter)}` : data.dataset.lastYear ? ` · balanços até ${data.dataset.lastYear}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="lg:hidden">
            <Button onClick={() => setPanelOpen((v) => !v)}>{panelOpen ? "Fechar filtros" : `Estratégias (${config.active.length})`}</Button>
          </span>
          <Button variant="primary" onClick={refresh} disabled={busy} title="Busca os fundamentos mais recentes publicados e as cotações do momento">
            {busy ? <Spinner /> : <span aria-hidden>↻</span>}
            Atualizar
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">
          Não foi possível atualizar: {error}
        </p>
      )}
      {warning && (
        <p role="status" className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {warning}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg border border-good/40 bg-good-soft px-4 py-3 text-sm text-good">
          {notice}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[21rem_1fr]">
        <aside className={`${panelOpen ? "block" : "hidden"} rounded-xl border border-line bg-surface p-4 lg:block lg:self-start`}>
          <StrategyPanel config={config} onChange={setConfig} />
        </aside>

        <main className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar papel ou empresa" aria-label="Buscar papel ou empresa" className="w-56 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
            <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Setor" className="max-w-56 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
              <option value="">Todos os setores</option>
              {sectors.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <p className="ml-auto text-sm text-ink-2">
              <strong className="num font-semibold text-ink">{passed}</strong> aprovadas de <span className="num">{evaluated.length}</span> no universo
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium">
                    <button type="button" onClick={() => sortBy("ticker")}>
                      Papel{arrow("ticker")}
                    </button>
                  </th>
                  {columns.map((c) => (
                    <th key={c.id} title={c.title} className={`px-3 py-2 text-right font-medium whitespace-nowrap ${c.hideSm ? "hidden md:table-cell" : ""}`}>
                      <button type="button" onClick={() => sortBy(c.id)}>
                        {c.label}
                        {arrow(c.id)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.stock.ticker} onClick={() => (location.hash = e.stock.ticker)} className={`cursor-pointer border-b border-line last:border-0 hover:bg-surface-2 ${e.pass ? "" : "text-ink-3"}`}>
                    <td className="sticky left-0 z-10 max-w-[8.5rem] bg-inherit sm:max-w-[13rem] px-3 py-2 [tr:not(:hover)>&]:bg-surface">
                      <span className="flex items-center gap-2">
                        {config.showFailed && <VerdictIcon pass={e.pass} />}
                        <span className="min-w-0">
                          <a href={`#${e.stock.ticker}`} onClick={(ev) => ev.stopPropagation()} className="font-semibold text-ink hover:underline">
                            {e.stock.ticker}
                          </a>
                          <span className="block truncate text-xs text-ink-3">{e.stock.name ?? "—"}</span>
                        </span>
                      </span>
                    </td>
                    {columns.map((c) => (
                      <td key={c.id} className={`num px-3 py-2 text-right whitespace-nowrap ${c.hideSm ? "hidden md:table-cell" : ""}`}>
                        {c.render(e)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-ink-2">
                Nenhum papel passa nos filtros atuais. Afrouxe os parâmetros, troque para “Qualquer (OU)” ou marque “Mostrar também as reprovadas”.
              </p>
            )}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Fontes: {data.source}. Margem = 1 − cotação ÷ preço teto. Ferramenta de estudo; não é recomendação de investimento.
          </p>
        </main>
      </div>
    </div>
  );
}
