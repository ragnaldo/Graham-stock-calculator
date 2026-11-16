"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Series {
  key: string;
  label: string;
}
type Row = { x: string | number } & Record<string, number | string | null>;

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const AXIS = { fontSize: 11, fill: "var(--ink-3)" };

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: { dataKey?: string | number; value?: number | null; color?: string }[];
  series: Series[];
  format: (v: number) => string;
  labelFormat?: (x: string | number) => string;
}

function Tip({ active, label, payload, series, format, labelFormat }: TipProps) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(label) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {series.length > 1 && <span>{series.find((s) => s.key === p.dataKey)?.label}</span>}
          <span className="num ml-auto font-medium text-ink">{typeof p.value === "number" ? format(p.value) : "–"}</span>
        </div>
      ))}
    </div>
  );
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  value?: number | [number, number];
}

/** Barra com a ponta do dado arredondada (4px) e a base reta na linha do zero. */
function RoundedBar({ x = 0, y = 0, width = 0, height = 0, fill, value }: BarShapeProps) {
  const h = Math.abs(height);
  if (!h || !Number.isFinite(y) || width <= 0) return null;
  const top = Math.min(y, y + height);
  const v = Array.isArray(value) ? value[1] - value[0] : (value ?? 0);
  const r = Math.min(4, width / 2, h);
  const d =
    v < 0
      ? `M${x},${top} h${width} v${h - r} a${r},${r} 0 0 1 ${-r},${r} h${-(width - 2 * r)} a${r},${r} 0 0 1 ${-r},${-r} Z`
      : `M${x},${top + h} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${width - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} Z`;
  return <path d={d} fill={fill} />;
}

export interface ChartProps {
  title: string;
  note?: string;
  kind: "line" | "bar";
  data: Row[];
  series: Series[];
  format: (v: number) => string;
  /** Formato curto para o eixo Y. */
  axisFormat?: (v: number) => string;
  labelFormat?: (x: string | number) => string;
  xTicks?: (string | number)[];
  xTickFormat?: (x: string | number) => string;
  dots?: boolean;
  height?: number;
}

export function Chart({ title, note, kind, data, series, format, axisFormat, labelFormat, xTicks, xTickFormat, dots = true, height = 190 }: ChartProps) {
  const has = data.some((r) => series.some((s) => typeof r[s.key] === "number"));
  const negative = data.some((r) => series.some((s) => typeof r[s.key] === "number" && (r[s.key] as number) < 0));
  const common = { data, margin: { top: 8, right: 12, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--grid)" />
      <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--line)" }} ticks={xTicks} tickFormatter={xTickFormat} minTickGap={12} interval={xTicks ? 0 : "preserveStartEnd"} />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={axisFormat ?? format} domain={kind === "bar" || negative ? [(min: number) => Math.min(0, min), "auto"] : ["auto", "auto"]} />
      {negative && <ReferenceLine y={0} stroke="var(--ink-3)" />}
      <Tooltip content={<Tip series={series} format={format} labelFormat={labelFormat} />} cursor={kind === "bar" ? { fill: "var(--surface-2)" } : { stroke: "var(--ink-3)", strokeDasharray: "3 3" }} isAnimationActive={false} />
    </>
  );
  return (
    <figure className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <figcaption className="mb-2">
        <span className="text-sm font-semibold">{title}</span>
        {note && <span className="ml-2 text-xs text-ink-3">{note}</span>}
        {series.length > 1 && (
          <span className="mt-1 flex flex-wrap gap-3 text-xs text-ink-2">
            {series.map((s, i) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-3 rounded-sm" style={{ background: COLORS[i] }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      {!has ? (
        <p className="flex items-center justify-center text-sm text-ink-3" style={{ height }}>
          Sem dados
        </p>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {kind === "bar" ? (
              <BarChart {...common} barCategoryGap="22%" barGap={2}>
                {axes}
                {series.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} fill={COLORS[i]} maxBarSize={26} shape={<RoundedBar />} isAnimationActive={false} />
                ))}
              </BarChart>
            ) : (
              <LineChart {...common}>
                {axes}
                {series.map((s, i) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    stroke={COLORS[i]}
                    strokeWidth={2}
                    connectNulls
                    dot={dots ? { r: 3.5, fill: COLORS[i], stroke: "var(--surface)", strokeWidth: 2 } : false}
                    activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
