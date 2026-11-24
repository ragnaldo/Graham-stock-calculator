// Grandes setores: agrupa a classificação da CVM pelo tipo de risco que os negócios dividem
// (juros e crédito, preço de commodity, consumo das famílias, regulação de tarifas...).

const GROUPS: [string, RegExp][] = [
  ["Financeiro", /banco|intermedia|segurador|bolsa|cr[ée]dito imob|financ/i],
  ["Petróleo, mineração e siderurgia", /petr[óo]leo|extra[çc][ãa]o mineral|metalurgia|siderurgia|petroqu[íi]mic/i],
  ["Utilidade pública", /energia el[ée]trica|saneamento|g[áa]s$|água/i],
  ["Agronegócio e papel", /agricultura|a[çc][úu]car|papel e celulose/i],
  ["Construção e imobiliário", /const(r|\.)|imobili/i],
  ["Consumo", /com[ée]rcio|varejo|t[êe]xtil|vestu[áa]rio|alimentos|bebidas|brinquedos|lazer|hospedagem|turismo|farmac|higiene|embalagens/i],
  ["Saúde e educação", /m[ée]dic|sa[úu]de|hospital|educa[çc]/i],
  ["Indústria e logística", /m[áa]quinas|m[áa]qs|equip|ve[íi]c|transporte|log[íi]stica/i],
  ["Tecnologia e telecom", /comunica[çc][ãa]o|inform[áa]tica|telecom|tecnologia/i],
];

/** Grande setor de um setor da CVM. */
export function macroSector(sector: string | null | undefined): string {
  if (!sector) return "Outros";
  for (const [group, re] of GROUPS) if (re.test(sector)) return group;
  return /sem setor/i.test(sector) ? "Holdings e outros" : "Outros";
}
