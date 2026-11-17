import { DEFAULT_CONFIG, FIELDS, STRATEGIES, defaultParams, type ActiveStrategy, type Rule, type ScreenConfig, type Strategy } from "@/core/strategies";
import { Button } from "./ui";

const inputCls = "num w-full rounded-md border border-line bg-bg px-2 py-1 text-sm text-right";

function NumberField({ value, onChange, min, max, step, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  return (
    <input
      type="number"
      aria-label={label}
      className={inputCls}
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

function RulesEditor({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  const update = (i: number, patch: Partial<Rule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_3.2rem_4.5rem_1.5rem] items-center gap-1.5">
          <select aria-label="Indicador" className="rounded-md border border-line bg-bg px-1.5 py-1 text-sm" value={r.field} onChange={(e) => update(i, { field: e.target.value })}>
            {FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
                {f.kind === "pct" ? " (%)" : ""}
              </option>
            ))}
          </select>
          <select aria-label="Operador" className="rounded-md border border-line bg-bg px-1 py-1 text-sm" value={r.op} onChange={(e) => update(i, { op: e.target.value as Rule["op"] })}>
            <option value=">=">≥</option>
            <option value="<=">≤</option>
          </select>
          <NumberField label="Valor" value={r.value} step={0.5} onChange={(v) => update(i, { value: v })} />
          <button type="button" aria-label="Remover regra" className="rounded text-ink-3 hover:text-bad" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => onChange([...rules, { field: "roe", op: ">=", value: 15 }])}>
        + Adicionar regra
      </Button>
    </div>
  );
}

function StrategyCard({ strategy, active, onToggle, onChange }: { strategy: Strategy; active: ActiveStrategy | undefined; onToggle: () => void; onChange: (a: ActiveStrategy) => void }) {
  const params = { ...defaultParams(strategy), ...active?.params };
  return (
    <div className={`rounded-lg border ${active ? "border-accent bg-accent-soft/40" : "border-line"}`}>
      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={!!active} onChange={onToggle} />
        <span>
          <span className="block text-sm font-medium">{strategy.name}</span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-2">{strategy.description}</span>
        </span>
      </label>
      {active && (strategy.params.length > 0 || strategy.usesRules) && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {strategy.params.map((p) => (
            <div key={p.key} className="grid grid-cols-[1fr_5.5rem] items-center gap-2">
              <span className="text-xs text-ink-2" title={p.help}>
                {p.label}
                {p.unit ? ` (${p.unit})` : ""}
                {p.help ? " ⓘ" : ""}
              </span>
              <NumberField label={p.label} value={params[p.key]} min={p.min} max={p.max} step={p.step} onChange={(v) => onChange({ ...active, params: { ...params, [p.key]: v } })} />
            </div>
          ))}
          {strategy.usesRules && <RulesEditor rules={active.rules ?? []} onChange={(rules) => onChange({ ...active, rules })} />}
        </div>
      )}
    </div>
  );
}

export function StrategyPanel({ config, onChange }: { config: ScreenConfig; onChange: (c: ScreenConfig) => void }) {
  const toggle = (s: Strategy) => {
    const on = config.active.some((a) => a.id === s.id);
    onChange({
      ...config,
      active: on ? config.active.filter((a) => a.id !== s.id) : [...config.active, { id: s.id, params: defaultParams(s), rules: s.usesRules ? [] : undefined }],
    });
  };
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Estratégias</h2>
          <Button variant="ghost" onClick={() => onChange(DEFAULT_CONFIG)}>
            Restaurar padrão
          </Button>
        </div>
        <div className="space-y-2">
          {STRATEGIES.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              active={config.active.find((a) => a.id === s.id)}
              onToggle={() => toggle(s)}
              onChange={(a) => onChange({ ...config, active: config.active.map((x) => (x.id === a.id ? a : x)) })}
            />
          ))}
        </div>
      </div>

      {config.active.length > 1 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Combinar estratégias</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-line p-1 text-sm">
            {(
              [
                ["all", "Todas (E)"],
                ["any", "Qualquer (OU)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={`cursor-pointer rounded-md px-2 py-1 text-center ${config.combine === value ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}>
                <input type="radio" name="combine" className="sr-only" checked={config.combine === value} onChange={() => onChange({ ...config, combine: value })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Universo</h2>
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-[1fr_7rem] items-center gap-2">
            <span className="text-xs text-ink-2">Liquidez diária mínima (R$ mil)</span>
            <NumberField label="Liquidez diária mínima" value={config.minLiquidity / 1000} min={0} step={100} onChange={(v) => onChange({ ...config, minLiquidity: v * 1000 })} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={config.onePerCompany} onChange={(e) => onChange({ ...config, onePerCompany: e.target.checked })} />
            Só o papel mais líquido de cada empresa
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={config.showFailed} onChange={(e) => onChange({ ...config, showFailed: e.target.checked })} />
            Mostrar também as reprovadas
          </label>
        </div>
      </div>
    </div>
  );
}
