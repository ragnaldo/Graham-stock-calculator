import { useMemo, useRef, useState } from "react";
import { fmtCompact, fmtDate, fmtNumber, fmtPct, fmtPrice } from "@/core/format";
import { computePortfolio, parseBackup, type Operation } from "@/core/portfolio";
import { getBenchmarks, portfolioContext, priceOn, tickerOptions } from "@/web/data";
import { storageWorks, useDataVersion, useOperations } from "@/web/hooks";
import { getSheetsConfig } from "@/web/sync";
import { Chart } from "./charts";
import { SheetsSync } from "./SheetsSync";
import { Button, Card, Margin } from "./ui";

const today = () => new Date().toISOString().slice(0, 10);
const brl = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const signedPct = (v: number | null) => (v === null ? "–" : `${v >= 0 ? "+" : "−"}${fmtPct(Math.abs(v))}`);
const SERIES_COLOR = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const EXAMPLE = "exemplo-";

// ---------- formulário ----------
interface Draft {
  id?: string;
  ticker: string;
  type: "C" | "V";
  date: string;
  qty: string;
  price: string;
  fees: string;
}
const emptyDraft = (): Draft => ({ ticker: "", type: "C", date: today(), qty: "", price: "", fees: "" });
const toNum = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

function OperationForm({ draft, setDraft, onSave, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; onSave: (op: Omit<Operation, "id">, id?: string) => void; onCancel?: () => void }) {
  const options = useMemo(tickerOptions, []);
  const [error, setError] = useState<string | null>(null);
  const ticker = draft.ticker.trim().toUpperCase();
  const known = options.find((o) => o.ticker === ticker);
  const suggestion = known && draft.date ? (draft.date >= today().slice(0, 7) ? known.price : priceOn(ticker, draft.date)) : null;
  const field = "w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = toNum(draft.qty);
    const price = toNum(draft.price);
    const fees = draft.fees ? toNum(draft.fees) : 0;
    if (!/^[A-Z0-9]{4}\d{1,2}$/.test(ticker)) return setError("Informe o código do papel, por exemplo PETR4.");
    if (!known) return setError(`${ticker} não está na base de papéis negociados.`);
    if (!draft.date || draft.date > today()) return setError("A data não pode ser futura.");
    if (!(qty > 0)) return setError("A quantidade precisa ser maior que zero.");
    if (!(price > 0)) return setError("O preço precisa ser maior que zero.");
    if (!(fees >= 0)) return setError("Taxas inválidas.");
    setError(null);
    onSave({ ticker, type: draft.type, date: draft.date, qty, price, fees: fees || undefined }, draft.id);
  };

  return (
    <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.9fr_1fr_0.8fr_0.9fr_0.8fr_auto] lg:items-end">
      <label className="text-xs text-ink-2">
        Papel
        <input id="op-ticker" list="tickers" value={draft.ticker} onChange={(e) => setDraft({ ...draft, ticker: e.target.value.toUpperCase() })} placeholder="PETR4" className={`${field} mt-1 uppercase`} autoComplete="off" />
        <datalist id="tickers">
          {options.map((o) => (
            <option key={o.ticker} value={o.ticker}>
              {o.name ?? ""}
            </option>
          ))}
        </datalist>
      </label>
      <label className="text-xs text-ink-2">
        Operação
        <select id="op-type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as "C" | "V" })} className={`${field} mt-1`}>
          <option value="C">Compra</option>
          <option value="V">Venda</option>
        </select>
      </label>
      <label className="text-xs text-ink-2">
        Data
        <input id="op-date" type="date" max={today()} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={`${field} mt-1`} />
      </label>
      <label className="text-xs text-ink-2">
        Quantidade
        <input id="op-qty" inputMode="decimal" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} placeholder="100" className={`${field} num mt-1 text-right`} />
      </label>
      <label className="text-xs text-ink-2">
        Preço (R$)
        <input id="op-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder={suggestion ? fmtNumber(suggestion) : "0,00"} className={`${field} num mt-1 text-right`} />
      </label>
      <label className="text-xs text-ink-2">
        Taxas (R$)
        <input id="op-fees" inputMode="decimal" value={draft.fees} onChange={(e) => setDraft({ ...draft, fees: e.target.value })} placeholder="0,00" className={`${field} num mt-1 text-right`} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          {draft.id ? "Salvar" : "Adicionar"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
      <div className="text-xs sm:col-span-2 lg:col-span-7">
        {error ? (
          <p role="alert" className="text-bad">
            {error}
          </p>
        ) : known ? (
          <p className="text-ink-3">
            {known.name}
            {suggestion && !draft.price && (
              <>
                {" · "}
                {draft.date >= today().slice(0, 7) ? "cotação atual" : "fechamento do mês"} {fmtPrice(suggestion)}{" "}
                <button type="button" className="text-accent underline" onClick={() => setDraft({ ...draft, price: fmtNumber(suggestion) })}>
                  usar
                </button>
              </>
            )}
          </p>
        ) : (
          <p className="text-ink-3">Informe o preço pago por ação, como na nota de corretagem.</p>
        )}
      </div>
    </form>
  );
}

// ---------- blocos do painel ----------
function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="num mt-1 text-lg font-semibold tracking-tight break-words sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-sm">{sub}</div>}
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number; weight: number; href?: string }[] }) {
  return (
    <ul className="space-y-2.5 p-4">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-2 text-sm">
            {r.href ? (
              <a href={r.href} className="min-w-0 truncate font-medium hover:underline">
                {r.label}
              </a>
            ) : (
              <span className="min-w-0 truncate">{r.label}</span>
            )}
            <span className="num shrink-0 text-ink-2">
              {fmtPct(r.weight)} · {fmtCompact(r.value)}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
            <div className="h-2 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(1, r.weight * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function sampleOps(): Omit<Operation, "id">[] {
  const pick: [string, string, number][] = [
    ["ITSA4", "2023-03-15", 300],
    ["WEGE3", "2023-08-10", 80],
    ["TAEE11", "2024-02-20", 60],
    ["PETR4", "2024-06-12", 100],
    ["ITSA4", "2025-01-15", 200],
    ["BBAS3", "2025-04-22", 150],
  ];
  return pick
    .map(([ticker, date, qty]) => ({ ticker, type: "C" as const, date, qty, price: Number((priceOn(ticker, date) ?? 0).toFixed(2)) }))
    .filter((o) => o.price > 0);
}

// ---------- tela ----------
export function Portfolio() {
  const version = useDataVersion();
  const { ops, add, update, remove, replace } = useOperations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Operation[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const persists = useMemo(storageWorks, []);

  const summary = useMemo(() => computePortfolio(ops, portfolioContext(), getBenchmarks()), [ops, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const bench = getBenchmarks();
  const isExample = ops.some((o) => o.id.startsWith(EXAMPLE));
  const sorted = useMemo(() => [...ops].sort((a, b) => b.date.localeCompare(a.date)), [ops]);

  const save = (op: Omit<Operation, "id">, id?: string) => {
    if (id) update({ ...op, id });
    else add(op);
    setDraft(emptyDraft());
  };
  const edit = (o: Operation) => {
    setDraft({ id: o.id, ticker: o.ticker, type: o.type, date: o.date, qty: String(o.qty).replace(".", ","), price: String(o.price).replace(".", ","), fees: o.fees ? String(o.fees).replace(".", ",") : "" });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const loadExample = () => replace(sampleOps().map((o, i) => ({ ...o, id: `${EXAMPLE}${i}` })));

  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ app: "calculadora-graham", version: 1, exportedAt: new Date().toISOString(), operations: ops }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `carteira-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importFile = async (file: File) => {
    try {
      const list = parseBackup(await file.text());
      setPending(list);
      setImportMsg(null);
    } catch (e) {
      setImportMsg({ ok: false, text: `Arquivo não reconhecido: ${(e as Error).message}.` });
    }
  };

  const chartData = summary.series.map((p) => ({ x: p.date, portfolio: p.portfolio, ibov: bench ? p.ibov : null, cdi: bench ? p.cdi : null }));
  const years = [...new Set(summary.series.map((p) => p.date.slice(0, 4)))];
  const ticks = summary.series.length > 18 ? summary.series.filter((p, i, a) => i === 0 || p.date.slice(0, 4) !== a[i - 1].date.slice(0, 4)).map((p) => p.date) : undefined;
  const compare = [
    { key: "Minha carteira", pct: summary.returnPct, value: summary.value + summary.withdrawn + summary.dividends },
    { key: "Ibovespa", pct: summary.ibov?.returnPct ?? null, value: summary.ibov ? summary.ibov.value + summary.withdrawn : null },
    { key: "CDI", pct: summary.cdi?.returnPct ?? null, value: summary.cdi ? summary.cdi.value + summary.withdrawn : null },
  ];
  const maxAbs = Math.max(0.0001, ...compare.map((c) => Math.abs(c.pct ?? 0)));

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Minha carteira</h1>
          <p className="mt-1 text-sm text-ink-2">Preço médio, proventos e rentabilidade comparada com Ibovespa e CDI, considerando os mesmos aportes nas mesmas datas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportFile} disabled={!ops.length} title="Salva um arquivo com suas operações">
            Exportar backup
          </Button>
          <Button onClick={() => fileRef.current?.click()} title="Carrega um arquivo exportado antes">
            Importar backup
          </Button>
          <input
            ref={fileRef}
            id="import-file"
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <SheetsSync />

      {!persists && !getSheetsConfig() && (
        <p role="status" className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          Este navegador não está deixando salvar dados (aba anônima ou bloqueio). As operações valem só até fechar a página: use Exportar backup.
        </p>
      )}
      {pending && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
          <span>
            O arquivo tem {pending.length} operações.{" "}
            {ops.length ? `Substituir as ${ops.length} atuais ou somar a elas?` : "Carregar?"}
          </span>
          <span className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                replace(pending);
                setImportMsg({ ok: true, text: `${pending.length} operações carregadas.` });
                setPending(null);
              }}
            >
              {ops.length ? "Substituir" : "Carregar"}
            </Button>
            {ops.length > 0 && (
              <Button
                onClick={() => {
                  const ids = new Set(ops.map((o) => o.id));
                  replace([...ops, ...pending.filter((o) => !ids.has(o.id))]);
                  setImportMsg({ ok: true, text: "Operações somadas à carteira." });
                  setPending(null);
                }}
              >
                Somar
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
          </span>
        </div>
      )}
      {importMsg && (
        <p role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${importMsg.ok ? "border-good/40 bg-good-soft text-good" : "border-bad/40 bg-bad-soft text-bad"}`}>
          {importMsg.text}
        </p>
      )}
      {isExample && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          <span>Carteira de exemplo, com preços reais das datas. Apague para cadastrar a sua.</span>
          <Button onClick={() => replace(ops.filter((o) => !o.id.startsWith(EXAMPLE)))}>Apagar exemplo</Button>
        </div>
      )}

      <div ref={formRef}>
        <Card title={draft.id ? "Editar operação" : "Adicionar operação"} className="mb-5">
          <OperationForm draft={draft} setDraft={setDraft} onSave={save} onCancel={draft.id ? () => setDraft(emptyDraft()) : undefined} />
        </Card>
      </div>

      {ops.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-base font-medium">Sua carteira está vazia</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-ink-2">
            Cadastre cada compra (e venda) com a data e o preço pago. O painel calcula o preço médio, corrige desdobramentos, soma os proventos e compara com Ibovespa e CDI.
          </p>
          <div className="mt-4">
            <Button onClick={loadExample}>Ver com uma carteira de exemplo</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Patrimônio" value={brl(summary.value)} sub={<span className="text-ink-3">{summary.positions.length} posições</span>} />
            <Kpi label="Total aportado" value={brl(summary.contributed)} sub={summary.withdrawn > 0 ? <span className="text-ink-3">{brl(summary.withdrawn)} recebidos em vendas</span> : <span className="text-ink-3">desde {fmtDate(summary.firstDate)}</span>} />
            <Kpi
              label="Resultado"
              value={<span className={summary.result >= 0 ? "text-good" : "text-bad"}>{brl(summary.result)}</span>}
              sub={
                <span>
                  <Margin value={summary.returnPct} /> <span className="text-ink-3">sobre o aportado</span>
                </span>
              }
            />
            <Kpi label="Proventos recebidos" value={brl(summary.dividends)} sub={<span className="text-ink-3">dividendos e JCP, pela data com</span>} />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-[22rem_1fr]">
            <Card title="Carteira vs Ibovespa vs CDI">
              <ul className="space-y-4 p-4">
                {compare.map((c, i) => (
                  <li key={c.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLOR[i] }} />
                        {c.key}
                      </span>
                      <span className={`num text-lg font-semibold ${c.pct === null ? "" : c.pct >= 0 ? "text-good" : "text-bad"}`}>{signedPct(c.pct)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
                      <div className="h-2 rounded-full" style={{ width: `${(Math.abs(c.pct ?? 0) / maxAbs) * 100}%`, background: SERIES_COLOR[i], opacity: (c.pct ?? 0) < 0 ? 0.5 : 1 }} />
                    </div>
                    <div className="num mt-0.5 text-xs text-ink-3">{c.value === null ? "sem dados" : `${brl(c.value)} ao todo`}</div>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-4 py-2 text-xs leading-snug text-ink-3">
                Simula os mesmos valores aplicados e retirados nas mesmas datas em cada alternativa. O Ibovespa já inclui proventos reinvestidos.
                {bench ? ` Índices até ${fmtDate(bench.ibov.at(-1)?.[0])}.` : " Índices indisponíveis nesta base."}
              </p>
            </Card>
            <Chart
              title="Rentabilidade acumulada"
              note={years.length > 1 ? `fechamentos mensais de ${years[0]} a hoje` : "fechamentos mensais até hoje"}
              kind="line"
              dots={summary.series.length <= 24}
              height={280}
              data={chartData}
              series={[
                { key: "portfolio", label: "Minha carteira" },
                { key: "ibov", label: "Ibovespa" },
                { key: "cdi", label: "CDI" },
              ]}
              format={(v) => signedPct(v)}
              axisFormat={(v) => fmtPct(v, 0)}
              labelFormat={(x) => fmtDate(String(x))}
              xTicks={ticks}
              xTickFormat={(x) => (ticks ? String(x).slice(0, 4) : `${String(x).slice(5, 7)}/${String(x).slice(2, 4)}`)}
            />
          </div>

          <Card title="Posições" aside={<span className="text-xs text-ink-3">Quantidades e preço médio já corrigidos por desdobramentos e grupamentos</span>} className="mb-5">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-2">
                    <th className="px-3 py-2 text-left font-medium">Papel</th>
                    {["Quantidade", "Preço médio", "Cotação", "Valor", "Resultado", "Variação", "Proventos", "Peso"].map((h) => (
                      <th key={h} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.positions.map((p) => (
                    <tr key={p.ticker} className="border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="max-w-[13rem] px-3 py-2">
                        <a href={`#${p.ticker}`} className="font-semibold hover:underline">
                          {p.ticker}
                        </a>
                        <span className="block truncate text-xs text-ink-3">{p.name ?? "—"}</span>
                      </td>
                      <td className="num px-3 py-2 text-right">{fmtNumber(p.qty, Number.isInteger(p.qty) ? 0 : 2)}</td>
                      <td className="num px-3 py-2 text-right">{fmtPrice(p.avgPrice)}</td>
                      <td className="num px-3 py-2 text-right">{fmtPrice(p.price)}</td>
                      <td className="num px-3 py-2 text-right">{brl(p.value)}</td>
                      <td className={`num px-3 py-2 text-right ${p.gain >= 0 ? "text-good" : "text-bad"}`}>{brl(p.gain)}</td>
                      <td className="num px-3 py-2 text-right">
                        <Margin value={p.gainPct} />
                      </td>
                      <td className="num px-3 py-2 text-right">{brl(p.dividends)}</td>
                      <td className="num px-3 py-2 text-right">{fmtPct(p.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.closed.length > 0 && (
              <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                Posições encerradas: {summary.closed.map((c) => `${c.ticker} (lucro realizado ${brl(c.realized)}, proventos ${brl(c.dividends)})`).join("; ")}.
              </p>
            )}
          </Card>

          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <Card title="Alocação por ativo">
              <Bars rows={summary.positions.map((p) => ({ label: p.ticker, value: p.value, weight: p.weight, href: `#${p.ticker}` }))} />
            </Card>
            <Card title="Alocação por setor">
              <Bars rows={summary.bySector.map((s) => ({ label: s.sector, value: s.value, weight: s.weight }))} />
            </Card>
          </div>

          {summary.warnings.length > 0 && (
            <ul role="status" className="mb-5 space-y-1 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
              {summary.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <Card
            title="Operações"
            aside={
              confirm === "all" ? (
                <span className="flex items-center gap-2 text-xs">
                  Apagar todas?
                  <Button
                    variant="primary"
                    onClick={() => {
                      replace([]);
                      setConfirm(null);
                    }}
                  >
                    Apagar
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm(null)}>
                    Cancelar
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" onClick={() => setConfirm("all")}>
                  Apagar todas
                </Button>
              )
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-2">
                    <th className="px-3 py-2 text-left font-medium">Data</th>
                    <th className="px-3 py-2 text-left font-medium">Papel</th>
                    <th className="px-3 py-2 text-left font-medium">Operação</th>
                    {["Quantidade", "Preço", "Taxas", "Total"].map((h) => (
                      <th key={h} className="px-3 py-2 text-right font-medium">
                        {h}
                      </th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((o) => (
                    <tr key={o.id} className={`border-b border-line last:border-0 ${draft.id === o.id ? "bg-accent-soft/40" : ""}`}>
                      <td className="num px-3 py-1.5 whitespace-nowrap">{fmtDate(o.date)}</td>
                      <td className="px-3 py-1.5 font-medium">{o.ticker}</td>
                      <td className="px-3 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${o.type === "C" ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn"}`}>{o.type === "C" ? "Compra" : "Venda"}</span>
                      </td>
                      <td className="num px-3 py-1.5 text-right">{fmtNumber(o.qty, Number.isInteger(o.qty) ? 0 : 2)}</td>
                      <td className="num px-3 py-1.5 text-right">{fmtPrice(o.price)}</td>
                      <td className="num px-3 py-1.5 text-right">{o.fees ? fmtPrice(o.fees) : "–"}</td>
                      <td className="num px-3 py-1.5 text-right">{brl(o.qty * o.price + (o.type === "C" ? 1 : -1) * (o.fees ?? 0))}</td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">
                        {confirm === o.id ? (
                          <span className="inline-flex gap-1">
                            <Button
                              variant="primary"
                              onClick={() => {
                                remove(o.id);
                                setConfirm(null);
                              }}
                            >
                              Excluir
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirm(null)}>
                              Não
                            </Button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-1">
                            <Button variant="ghost" onClick={() => edit(o)}>
                              Editar
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirm(o.id)}>
                              Excluir
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-3">
        {getSheetsConfig()
          ? "As operações ficam na sua planilha do Google e numa cópia neste navegador."
          : "Sem planilha conectada, as operações ficam só neste navegador: conecte o Google Planilhas ou use Exportar backup."}{" "}
        Valores do dia usam a cotação mais recente; o gráfico usa fechamentos mensais. Proventos contam pela data com, mesmo os ainda não pagos.
      </p>
    </div>
  );
}
