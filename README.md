# Caderneta 2

Gestão financeira pessoal **offline-first**: modos Diária e Salário Mensal, calendário de dias trabalhados, contas e cartões, recorrências, parcelamentos, orçamento, metas, previsões e insights, com sincronização entre celular e computador.

A versão 1 (HTML/CSS/JS + LocalStorage) continua em `../finance/`. Os dados dela são migrados automaticamente para a 2.x (veja [Migração da v1](#migração-da-v1)).

## Arquitetura

```
Antes:   Interface → JavaScript → LocalStorage

Agora:   React (PWA) → IndexedDB ──sync──→ API Node/Express → PostgreSQL
                 ↑ funciona offline      ↑ quando há sessão e internet
```

| Camada | Tecnologia | Onde |
|---|---|---|
| Frontend | React 19 + Vite 8, PWA (vite-plugin-pwa/Workbox) | `client/` |
| Dados locais | IndexedDB (Dexie) | `client/src/lib/db.js`, `store.js` |
| Regras financeiras | Funções puras, testadas em Node | `client/src/lib/finance.js`, `insights.js` |
| Sincronização | Push/pull com cursor, "última escrita vence" | `client/src/lib/sync.js`, `server/src/sync.js` |
| Backend | Node 24 + Express 5, zod, helmet, rate limit | `server/src/` |
| Banco | PostgreSQL (migrações SQL versionadas) | `server/migrations/` |
| Autenticação | E-mail + senha (bcrypt), sessão persistente de 90 dias (token opaco, guardado com hash) | `server/src/auth.js` |

### Por que offline-first

O app **nunca espera o servidor**. Toda gravação vai primeiro para o IndexedDB, marcada como pendente. O sincronizador envia as pendências e baixa o que mudou em outros aparelhos:

- ao abrir o app, ao voltar a conexão, ao voltar para a aba, a cada 60 s e ~1,5 s depois de cada alteração;
- em lotes de 500, com cursor (`seq`) para buscar só o que mudou;
- conflito: vence a alteração mais recente (`updatedAt`); exclusões viram "lápides" para também sincronizar;
- um lock consultivo por usuário no Postgres impede que uma leitura "pule" um registro gravado em paralelo.

Sem conta, o Caderneta funciona 100% local. Criando uma conta depois, tudo o que está no aparelho sobe para a nuvem.

**Ids determinísticos evitam duplicatas entre aparelhos:** dia trabalhado = `workday:2026-09-23`, ocorrência de recorrência = `<recorrência>:<data>`, parcela = `<grupo>:<n>`, categorias e conta padrão têm ids fixos. Se dois aparelhos gerarem o mesmo registro offline, ele vira um só.

## Rodando localmente

Pré-requisito: Node 24+.

```bash
npm install

# Terminal 1 — PostgreSQL local sem Docker (dados em server/.pgdata)
npm run db:dev

# Terminal 2 — API em http://localhost:3001
cp server/.env.example server/.env
npm run dev:server

# Terminal 3 — app em http://localhost:5173 (proxy /api → 3001)
npm run dev:client
```

Com Docker, em vez dos três terminais: `docker compose up --build` e abra http://localhost:3001.

### Produção

```bash
npm run build   # gera client/dist
npm start       # a API serve o PWA + /api na mesma origem
```

Variáveis: `DATABASE_URL` (obrigatória) e `PORT` (padrão 3001). As migrações rodam sozinhas na inicialização. Use HTTPS em produção (necessário para service worker e notificações fora do localhost).

### Testes

```bash
npm test
```

- `client/test/` — regras financeiras: saldos, recibos Diária/Mensal, faturas de cartão, recorrências, parcelas, orçamento, previsão, metas, insights, sugestão de categoria e migração da v1.
- `server/test/` — integração com PostgreSQL real (embutido): cadastro, login, sessões, isolamento entre usuários, "última escrita vence", paginação, exclusão de conta.

## Módulos

| Módulo | O que faz |
|---|---|
| **Início** | Saldo atual, receitas e despesas do mês, diárias a receber, contas planejadas e disponível após o planejamento; últimas movimentações; diárias do mês; seções recolhíveis com próximos 7 dias, gráficos, maiores gastos e insights |
| **Movimentações** | Receitas e despesas reais (abas), transferências entre contas próprias; mês, período ou histórico completo; busca, categoria, conta e origem; totais recebido/gasto; exportação CSV |
| **Diárias** | Calendário de dias trabalhados (marcação rápida), valor e observação por dia, resumo do mês (dias, total, recebido, pendente) e recebimentos. Nada aqui muda o saldo |
| **Planejamento** | Contas a juntar: só descrição, valor e vencimento; total por mês e "disponível após planejamento". Não cria lançamentos nem muda o saldo |
| **Contas e cartões** | Carteira, conta corrente, poupança, cartão, outras; cartão com limite, fechamento, vencimento, fatura atual, fatura a pagar, próximas faturas e pagamento de fatura |
| **Recorrentes e parcelas** | "Internet · R$ 120 · todo dia 10" gera os lançamentos sozinho; "Notebook · R$ 3.600 · 12x" cria e acompanha as 12 parcelas |
| **Orçamento** | Limite mensal por categoria, alerta em 80% e 100%, ritmo de gasto do mês |
| **Metas** | Depósitos e retiradas, quanto falta, previsão de conclusão pelo ritmo e valor mensal para cumprir o prazo |
| **Relatórios** | 6/12 meses, taxa de poupança, categorias, comparação com o mês anterior |
| **Ajustes** | Modo Diária/Mensal, conta e sincronização, tema, lembretes, backup JSON/CSV, restauração (v1 e v2) |
| **Busca global** | `Ctrl/⌘ + K` busca lançamentos, valores, contas, metas e páginas. `N` abre um novo lançamento |

### Os modos continuam sendo a identidade do Caderneta

- **Diária:** cada dia marcado fica na coleção `workdays`, com a diária *da época*, e **não** entra no saldo nem nas receitas. Quando a empresa paga, você lança **uma** receita real e informa quanto dela é das diárias (`workdayAmount`); o resto é complementar. Ex.: 8 × R$ 100 pagos com R$ 868 = uma receita de R$ 868 (R$ 800 de diárias + R$ 68 complementares).
- **Salário Mensal:** o salário vira uma recorrência que entra sozinha no dia do pagamento.
- Trocar de modo **preserva todos os dados**. Na v1, a troca apagava os lançamentos.

### Previsão de saldo no fim do mês

```
saldo em contas hoje
+ lançamentos já agendados no resto do mês
+ recorrências que ainda vão acontecer
− faturas de cartão que vencem até o fim do mês
− gasto variável projetado (média diária do mês × dias restantes; antes do dia 7, usa o mês anterior)
```

Diárias ainda não recebidas não entram na previsão. "Disponível após planejamento" no Início = saldo atual − total do planejamento (só informativo).

## Migração da v1

1. **Automática:** se a 2.x for publicada no mesmo endereço da v1, na primeira abertura ela lê `config`, `workedDays` e `transactions` do LocalStorage e converte. Os dados antigos **não são apagados**.
2. **Por backup:** em Boas-vindas ou em Ajustes → Restaurar backup, selecione o `.json` exportado pela v1.

Conversão: dias trabalhados → diárias (fora do saldo); gasto pessoal → despesa com categoria sugerida pela descrição; terceiro → despesa com o nome da pessoa; salário mensal → recorrência todo dia 5 (ajustável).

## Paleta dos gráficos

Receitas × despesas usam azul/laranja (e não verde/vermelho) para funcionar com daltonismo vermelho-verde. A paleta categórica de 8 cores foi validada contra as superfícies do Caderneta (`#FBF8F0` claro, `#1B2028` escuro): separação para daltonismo ≥ 8,4 e contraste ≥ 3:1 no tema escuro. No tema claro, três tons ficam abaixo de 3:1, por isso todo gráfico por categoria mostra rótulo e valor em texto, e há "Ver tabela" em todos os gráficos.

## Histórico de versões

- **2.0:** nova interface (sidebar no desktop, navegação inferior no celular), React + Vite, PWA offline, backend Node/Express, PostgreSQL, autenticação, sincronização, categorias, Dashboard 2.0, migração da v1.
- **2.1:** contas e cartões (faturas, limite, pagamento), recorrências, parcelamentos.
- **2.2:** metas, orçamento com alertas, previsão de saldo, insights por regras, relatórios.
- **3.0:** só receitas e despesas reais mudam o saldo. Diárias com coleção própria (`workdays`) e recebimento como receita única; contas a pagar viram Planejamento (sem pagamentos, reserva ou geração automática); Movimentações com abas, período e histórico; Início reorganizado; folhas e formulários que cabem acima do teclado no celular.

### Migração 3.0

Roda sozinha ao abrir o app (depois de sincronizar), uma vez por registro: o que já tem a marca `migration` é pulado.

- Diária "a receber" → registro em `workdays`; a transação vira lápide (os dados ficam guardados).
- Diária antiga lançada direto numa conta → continua receita (já estava no saldo), marcada como `legacy-workday` e listada para revisão.
- Pagamento de diárias (transferência a-receber → conta) → receita na mesma conta, com `workdayAmount`.
- Despesas de contas pagas (`billpay:`) ficam como estão; contas quitadas saem do planejamento (`archived`), as pagas em parte ficam com o que faltava.
- Antes de gravar, confere o saldo de cada conta antes/depois; se mudar, não grava nada. Guarda uma cópia completa do banco local antes da primeira gravação.
- **Ajustes → Atualização 3.0** mostra o relatório (inclui possíveis duplicações para revisar), baixa a cópia de antes e permite desfazer/reaplicar.

No servidor, a única mudança é a coleção `workdays` na lista de sincronização (sem migração SQL). Faça backup do PostgreSQL antes de publicar: `pg_dump "$DATABASE_URL" > caderneta_antes_3.0.sql`.
