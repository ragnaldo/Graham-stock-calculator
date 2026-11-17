# Calculadora Graham · B3

Triagem de ações da B3 pelas estratégias de Benjamin Graham, com fundamentos atuais e histórico de cada papel.
É um único arquivo HTML: código, estilos e dados vão dentro dele.

## Abrir

- **No computador**: baixe [`dist/calculadora-graham.html`](dist/calculadora-graham.html) e abra com dois cliques.
  Não precisa instalar nada.
- **Na web**: https://ragnaldo.github.io/Graham-stock-calculator/ (GitHub Pages).

O botão **Atualizar** busca as cotações do dia na [brapi.dev](https://brapi.dev) e recalcula P/L, P/VP, DY e as
margens de segurança. Dentro do claude.ai esse acesso é bloqueado; nesse caso a página mostra os dados da última coleta.

## O que tem

- **Lista** com todos os papéis, filtros por estratégia, busca, setor e ordenação.
- **Página do papel** (clique na linha): indicadores atuais, análise critério a critério, gráficos e tabela anual
  (cotação, P/L, P/VP, DY, LPA, VPA, proventos, receita, lucro, ROE, dívida) e proventos pagos.
- **Estratégias combináveis** (E / OU), com parâmetros editáveis e salvos no navegador:
  - Número de Graham — teto = √(22,5 × LPA × VPA)
  - Investidor defensivo — os 7 critérios do cap. 14 de *O Investidor Inteligente*
  - Fórmula de crescimento — V = LPA × (8,5 + 2g) × 4,4 / Y
  - Net-net (NCAV) — cotação ≤ 2/3 do ativo circulante líquido
  - Filtro por indicadores — regras livres (ROE ≥ x, dívida/patrimônio ≤ y…)

## Dados

| Dado | Fonte | Como atualizar |
| --- | --- | --- |
| Cotação do dia | brapi.dev | botão **Atualizar** na página |
| Indicadores atuais, balanço recente, proventos por ação | Fundamentus | `npm run data:quotes` (≈ 30 s) |
| Balanços anuais desde 2010, nº de ações, desdobramentos | CVM Dados Abertos (DFP, FRE, FCA) | `npm run data:update` |
| Cotações históricas mensais | B3 (COTAHIST) | `npm run data:update` |

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

O site no GitHub Pages é gerado pelo workflow `.github/workflows/pages.yml` a cada push e todo dia útil às 20:37,
com os indicadores do dia. Os balanços (CVM) e preços históricos (B3) vêm de `data/` no repositório: rode
`npm run data:update` e faça push para renová-los. Para republicar na hora: **Actions → Publicar site → Run workflow**.

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
