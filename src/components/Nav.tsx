import { useState } from "react";
import { fmtDateTime } from "@/core/format";
import { quarterLabel } from "@/core/history";
import { getStocks, refreshAll } from "@/web/data";
import { useDataVersion } from "@/web/hooks";
import { Button, Spinner } from "./ui";

export type View = "acoes" | "carteira" | "oportunidades" | "papel";

const TABS: { id: Exclude<View, "papel">; label: string; href: string }[] = [
  { id: "acoes", label: "Ações", href: "#" },
  { id: "oportunidades", label: "Oportunidades", href: "#oportunidades" },
  { id: "carteira", label: "Minha carteira", href: "#carteira" },
];

/** Barra do topo: navegação e o botão Atualizar, que vale para todas as telas. */
export function Nav({ view }: { view: View }) {
  useDataVersion();
  const data = getStocks();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "error"; text: string }[]>([]);

  const refresh = async () => {
    setBusy(true);
    setMsg([]);
    try {
      const r = await refreshAll();
      setMsg([{ kind: "ok" as const, text: r.message }, ...(r.warning ? [{ kind: "warn" as const, text: r.warning }] : [])]);
    } catch (e) {
      setMsg([{ kind: "error", text: `Não foi possível atualizar: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const cls = { ok: "border-good/40 bg-good-soft text-good", warn: "border-warn/40 bg-warn-soft text-warn", error: "border-bad/40 bg-bad-soft text-bad" };
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <a href="#" className="text-base font-semibold tracking-tight">
          Calculadora Graham <span className="text-ink-3">B3</span>
        </a>
        <nav aria-label="Seções" className="flex gap-1 overflow-x-auto text-sm">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={t.href}
              aria-current={view === t.id ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 whitespace-nowrap ${view === t.id ? "bg-ink font-medium text-surface" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-ink-3 md:inline">
            {data.live ? `Cotações de ${fmtDateTime(data.updatedAt)}` : `Dados de ${fmtDateTime(data.updatedAt)}`}
            {data.lastQuarter ? ` · balanços até ${quarterLabel(data.lastQuarter)}` : ""}
          </span>
          <Button variant="primary" onClick={refresh} disabled={busy} title="Busca os fundamentos mais recentes publicados e as cotações do momento">
            {busy ? <Spinner /> : <span aria-hidden>↻</span>}
            Atualizar
          </Button>
        </div>
      </div>
      {msg.length > 0 && (
        <div className="mx-auto max-w-[1500px] space-y-2 px-4 pb-3">
          {msg.map((m) => (
            <p key={m.text} role={m.kind === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${cls[m.kind]}`}>
              <span>{m.text}</span>
              <button type="button" aria-label="Fechar aviso" className="opacity-70 hover:opacity-100" onClick={() => setMsg((all) => all.filter((x) => x !== m))}>
                ✕
              </button>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
