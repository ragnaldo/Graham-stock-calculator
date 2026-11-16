import type { StockRow } from "../types";

export type Verdict = boolean | null; // null = dados insuficientes / não se aplica

export interface Criterion {
  id: string;
  label: string;
  pass: Verdict;
  /** Valor observado, já formatado. */
  value: string;
  /** Regra exigida, já formatada. */
  target: string;
  note?: string;
  /** Critério não se aplica ao papel (ex.: liquidez corrente em bancos); fica fora da pontuação. */
  na?: boolean;
}

export interface StrategyResult {
  pass: Verdict;
  criteria: Criterion[];
  /** Critérios atendidos / aplicáveis. */
  score: number;
  maxScore: number;
  /** Preço teto estimado pela estratégia, quando houver. */
  fairValue: number | null;
  /** Margem de segurança: 1 - preço / preço teto. */
  margin: number | null;
}

export interface ParamDef {
  key: string;
  label: string;
  help?: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export type Params = Record<string, number>;

export interface Rule {
  field: string;
  op: ">=" | "<=";
  value: number;
}

export interface Strategy {
  id: string;
  name: string;
  short: string;
  description: string;
  params: ParamDef[];
  /** Colunas que a estratégia acrescenta à tabela. */
  columns: ("fair" | "margin" | "score")[];
  /** Estratégia baseada em lista de regras livres (filtro por indicadores). */
  usesRules?: boolean;
  evaluate(stock: StockRow, params: Params, rules: Rule[]): StrategyResult;
}

export interface ActiveStrategy {
  id: string;
  params: Params;
  rules?: Rule[];
}

export interface ScreenConfig {
  active: ActiveStrategy[];
  /** all = precisa passar em todas; any = em pelo menos uma. */
  combine: "all" | "any";
  /** Liquidez diária mínima (R$). */
  minLiquidity: number;
  /** Mantém só o papel mais líquido de cada empresa. */
  onePerCompany: boolean;
  /** Mostra também os papéis reprovados. */
  showFailed: boolean;
}

export interface Evaluated {
  stock: StockRow;
  results: Record<string, StrategyResult>;
  pass: boolean;
}
