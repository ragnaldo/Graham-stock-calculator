# Calculadora Graham · B3

Triagem de ações da B3 pelas estratégias de Benjamin Graham, com fundamentos atuais e histórico de cada papel.
É um único arquivo HTML: código, estilos e dados vão dentro dele.

## Abrir

- **No computador**: baixe [`dist/calculadora-graham.html`](dist/calculadora-graham.html) e abra com dois cliques.
  Não precisa instalar nada.
- **Na web**: https://ragnaldo.github.io/Graham-stock-calculator/ (GitHub Pages).

O botão **Atualizar** faz duas buscas:

1. **Fundamentos**: baixa a base mais recente publicada no site (`data.json`), com indicadores do Fundamentus e
   balanços anuais e trimestrais da CVM. O workflow do GitHub coleta tudo de novo todo dia útil às 12:47 e às 20:37.
2. **Cotações**: busca os preços do momento na [brapi.dev](https://brapi.dev) e recalcula P/L, P/VP, DY e margens.

Funciona no site e no arquivo baixado. Dentro do claude.ai o acesso a outros sites é bloqueado; ali a página mostra
os dados embutidos.

## O que tem

- **Minha carteira**: cadastre compras e vendas (papel, data, quantidade, preço, taxas). Calcula preço médio,
  corrige desdobramentos, soma proventos pela data com e compara a rentabilidade com Ibovespa e CDI simulando os
  mesmos aportes nas mesmas datas. As operações ficam no navegador; use **Exportar backup** para guardar uma cópia.
- **Oportunidades**: empresas lucrativas e em operação normal, abaixo do Número de Graham ou do teto de Bazin e com
  4+ critérios do investidor defensivo, ordenadas por nota. Triagem para estudo, não recomendação.
- **Análise completa** na página de cada papel: preço teto central, rentabilidade, crescimento, endividamento,
  dividendos, caixa, governança (segmento, controle, auditor, acionistas) e links para os documentos na CVM.

- **Lista** com todos os papéis, filtros por estratégia, busca, setor e ordenação.
- **Página do papel** (clique na linha): indicadores atuais, análise critério a critério, gráficos e tabela anual
  (cotação, P/L, P/VP, DY, LPA, VPA, proventos, receita, lucro, ROE, dívida) e proventos pagos.
- **Estratégias combináveis** (E / OU), com parâmetros editáveis e salvos no navegador:
  - Número de Graham — teto = √(22,5 × LPA × VPA)
  - Investidor defensivo — os 7 critérios do cap. 14 de *O Investidor Inteligente*
  - Fórmula de crescimento — V = LPA × (8,5 + 2g) × 4,4 / Y
  - Net-net (NCAV) — cotação ≤ 2/3 do ativo circulante líquido
  - Preço teto de Bazin — proventos por ação ÷ 6%
  - Filtro por indicadores — regras livres (ROE ≥ x, dívida/patrimônio ≤ y…)

## Dados

| Dado | Fonte | Como atualizar |
| --- | --- | --- |
| Cotação do dia | brapi.dev | botão **Atualizar** na página |
| Indicadores atuais, balanço recente, proventos por ação | Fundamentus | `npm run data:quotes` (≈ 30 s) |
| Balanços anuais desde 2010, nº de ações, desdobramentos | CVM Dados Abertos (DFP, FRE, FCA) | `npm run data:update` |
| Cotações históricas mensais | B3 (COTAHIST) | `npm run data:update` |
| Governança: segmento, controle, auditor, acionistas, documentos | CVM (FCA, FRE, índices DFP/ITR) | `npm run data:update` |
| CDI e Ibovespa diários | Banco Central (SGS 12) e B3 | `npm run data:benchmarks` |

Depois de atualizar os dados, gere o HTML de novo:

```bash
npm install
```

```bash
npm run data:quotes
```

```bash
npm run build
```

O site no GitHub Pages é gerado pelo workflow `.github/workflows/pages.yml` a cada push e todo dia útil às 12:47 e
20:37: coleta os anos recentes da CVM (inclusive trimestres) e da B3 e os indicadores do Fundamentus. Os anos
antigos vêm de `data/` no repositório. Para republicar na hora: **Actions → Publicar site → Run workflow**.

`npm run data:update` baixa só os anos faltantes e os dois mais recentes; `-- --full` refaz tudo desde 2010
(≈ 1 GB de downloads, guardados em `.cache/downloads`).

Limitações conhecidas:

- O Fundamentus é lido por raspagem de página; se o site mudar o HTML, o parser em `scripts/fundamentus.ts` precisa de ajuste.
- O Atualizar só muda o preço. Lucro, patrimônio e demais dados de balanço valem da última coleta.
- Dividendos usados na triagem vêm do fluxo de caixa (DFC) da CVM por busca de texto nas contas; são aproximados.
  A página do papel usa os proventos por ação do Fundamentus.
- Valores por ação do histórico usam as ações em circulação de cada ano, ajustadas por desdobramentos confirmados
  no preço. Bonificações pequenas (< 10%) não são ajustadas.
- Tickers que o cadastro da CVM traz errados são corrigidos em `scripts/ticker-overrides.json`.

## Estrutura

```
src/core/         regras de negócio em TypeScript puro — reutilizável no app mobile
  strategies/     motor de estratégias; registro em strategies/index.ts
  history.ts      valores por ação, ajuste por desdobramentos, séries anuais
  dataset.ts      formato da base embutida e montagem das linhas e do detalhe
src/web/          app (React): rotas por #, dados embutidos, Atualizar via brapi
src/components/   interface (lista, painel de estratégias, página do papel, gráficos)
scripts/          coleta (CVM, B3, Fundamentus) e geração do HTML
data/             base coletada (JSON)
```

### Criar uma estratégia

1. Implemente a interface `Strategy` (`src/core/strategies/types.ts`): `params` declara os parâmetros editáveis e
   `evaluate(stock, params)` devolve os critérios, o preço teto e o veredito.
2. Adicione ao array `STRATEGIES` em `src/core/strategies/index.ts`.
3. `npm run build`.

A interface, a combinação E/OU e as colunas da tabela aparecem sozinhas.

Outros comandos: `npm test`, `npm run typecheck`.

---

Ferramenta de estudo. Não é recomendação de investimento.
