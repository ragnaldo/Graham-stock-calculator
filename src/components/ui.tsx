import type { ReactNode } from "react";
import type { Verdict } from "@/core/strategies";
import { fmtPct } from "@/core/format";

/** Ícone + rótulo: o estado nunca depende só da cor. */
export function VerdictBadge({ pass, labels }: { pass: Verdict; labels?: [string, string, string] }) {
  const [yes, no, unknown] = labels ?? ["Aprovada", "Reprovada", "Sem dados"];
  const cls = pass === true ? "bg-good-soft text-good" : pass === false ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink-2";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
      <VerdictIcon pass={pass} />
      {pass === true ? yes : pass === false ? no : unknown}
    </span>
  );
}

export function VerdictIcon({ pass }: { pass: Verdict }) {
  const label = pass === true ? "atende" : pass === false ? "não atende" : "sem dados";
  const cls = pass === true ? "text-good" : pass === false ? "text-bad" : "text-ink-3";
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" role="img" aria-label={label} className={`shrink-0 ${cls}`}>
      {pass === true && <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {pass === false && <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      {pass === null && <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

/** Margem de segurança com sinal explícito. */
export function Margin({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-ink-3">–</span>;
  const cls = value >= 0 ? "text-good" : "text-bad";
  return <span className={`num font-medium ${cls}`}>{value >= 0 ? "+" : "−"}{fmtPct(Math.abs(value))}</span>;
}

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {(title || aside) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

export function Button({ children, onClick, disabled, variant = "default", type = "button", title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "default" | "primary" | "ghost"; type?: "button" | "submit"; title?: string }) {
  const cls =
    variant === "primary"
      ? "bg-ink text-surface hover:opacity-90"
      : variant === "ghost"
        ? "text-ink-2 hover:bg-surface-2"
        : "border border-line bg-surface hover:bg-surface-2";
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}
