# Calculadora Graham · B3

Triagem de ações da B3 pelas estratégias de Benjamin Graham, com fundamentos atuais e histórico de cada papel.

## Rodar

```bash
npm install
```

```bash
npm run dev
```

Abra http://localhost:3000. O botão **Atualizar** busca cotações e fundamentos atuais na fonte.

Outros comandos: `npm test` (testes), `npm run typecheck`, `npm run lint`, `npm run build`.

## O que tem

- **Lista** com todos os papéis, filtros por estratégia, busca, setor e ordenação.
- **Página do papel** (`/acao/PETR4`): indicadores atuais, análise critério a critério, gráficos e tabela anual
  (cotação, P/L, P/VP, DY, LPA, VPA, proventos, receita, lucro, ROE, dívida) e proventos pagos.
- **Estratégias combináveis** (E / OU), com parâmetros editáveis e salvos no navegador:
  - Número de Graham — teto = √(22,5 × LPA × VPA)
  - Investidor defensivo — os 7 critérios do cap. 14 de *O Investidor Inteligente*
  - Fórmula de crescimento — V = LPA × (8,5 + 2g) × 4,4 / Y
  - Net-net (NCAV) — cotação ≤ 2/3 do ativo circulante líquido
  - Filtro por indicadores — regras livres (ROE ≥ x, dívida/patrimônio ≤ y…)

## Dados

| Dado | Fonte | Atualização |
| --- | --- | --- |
| Cotação e indicadores atuais, proventos por ação | Fundamentus (páginas públicas) | botão **Atualizar** |
| Balanços anuais desde 2010, nº de ações, desdobramentos | CVM Dados Abertos (DFP, FRE, FCA) | `npm run data:update` |
| Cotações históricas mensais | B3 (COTAHIST) | `npm run data:update` |

A base histórica fica em `data/*.json` e vai junto no repositório. Para atualizá-la:

```bash
npm run data:update
```

Baixa só os anos faltantes e os dois mais recentes. `-- --full` refaz tudo desde 2010 (≈ 1 GB de downloads, guardados em
`.cache/downloads`); `-- --no-prices` pula a B3.

Limitações conhecidas:

- O Fundamentus é lido por raspagem de página; se o site mudar o HTML, o parser em `src/server/fundamentus.ts` precisa de ajuste.
- Dividendos usados na triagem vêm do fluxo de caixa (DFC) da CVM por busca de texto nas contas; são aproximados.
  A página do papel usa os proventos por ação do Fundamentus.
- Valores por ação do histórico usam as ações em circulação de cada ano, ajustadas por desdobramentos confirmados
  no preço. Bonificações pequenas (< 10%) não são ajustadas.
- Tickers que o cadastro da CVM traz errados são corrigidos em `scripts/ticker-overrides.json`.

## Estrutura

```
src/core/         regras de negócio em TypeScript puro (sem React) — reutilizável no app mobile
  strategies/     motor de estratégias; registro em strategies/index.ts
  history.ts      valores por ação, ajuste por desdobramentos, séries anuais
src/server/       provedor Fundamentus, base histórica, cache (.cache/api)
src/app/api/      API JSON: /api/stocks, /api/stocks/refresh, /api/stocks/[ticker]
src/components/   interface (lista, painel de estratégias, página do papel, gráficos)
scripts/          geração da base histórica (CVM + B3)
```

### Criar uma estratégia

1. Implemente a interface `Strategy` (`src/core/strategies/types.ts`): `params` declara os parâmetros editáveis e
   `evaluate(stock, params)` devolve os critérios, o preço teto e o veredito.
2. Adicione ao array `STRATEGIES` em `src/core/strategies/index.ts`.

A interface, a combinação E/OU e as colunas da tabela aparecem sozinhas.

### App mobile (próximo passo)

A interface só conversa com a API JSON, e as regras estão em `src/core` sem dependência de navegador. Um app
(React Native/Expo ou PWA) reaproveita `src/core` e consome as mesmas rotas.

---

Ferramenta de estudo. Não é recomendação de investimento.
