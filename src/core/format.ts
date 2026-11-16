const nf = (min: number, max: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const n2 = nf(2, 2);
const n1 = nf(1, 1);
const n0 = nf(0, 0);

const DASH = "–";
const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export const fmtNumber = (v: number | null | undefined, digits = 2) => (ok(v) ? nf(digits, digits).format(v) : DASH);
export const fmtPrice = (v: number | null | undefined) => (ok(v) ? `R$ ${n2.format(v)}` : DASH);
export const fmtPct = (v: number | null | undefined, digits = 1) => (ok(v) ? `${nf(digits, digits).format(v * 100)}%` : DASH);
export const fmtMultiple = (v: number | null | undefined) => (ok(v) ? n2.format(v) : DASH);
export const fmtInt = (v: number | null | undefined) => (ok(v) ? n0.format(v) : DASH);

/** R$ compacto: 1,2 bi / 350 mi / 12 mil. */
export function fmtCompact(v: number | null | undefined, prefix = "R$ "): string {
  if (!ok(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e12) return `${prefix}${n2.format(v / 1e12)} tri`;
  if (a >= 1e9) return `${prefix}${n1.format(v / 1e9)} bi`;
  if (a >= 1e6) return `${prefix}${n1.format(v / 1e6)} mi`;
  if (a >= 1e3) return `${prefix}${n0.format(v / 1e3)} mil`;
  return `${prefix}${n0.format(v)}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}
