# Processamentos — BIG GLASS (front-end)

Tela de acompanhamento e solicitação de processamentos, a partir do protótipo
"Processamentos — protótipo navegável". **Só front-end**: o Flask apenas entrega a
página e os arquivos estáticos. Os dados vêm de uma camada de API em JavaScript que
hoje é **simulada no navegador** e pode apontar para as APIs reais sem mexer na tela.

## Como rodar

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
python app.py
```

Abra http://127.0.0.1:5000. Com `FLASK_DEBUG=1` o servidor recarrega ao salvar.

## O que a tela faz

- **Lista**: cards de resumo (Todos, Na fila, Processando, Concluídos, Com problema),
  busca por nome ou ID, filtro por usuário, paginação (10 por página) e atualização
  automática a cada 60 s (ou pelo botão *Atualizar*). Os filtros ficam na URL, então
  F5 e links compartilhados mantêm o estado.
- **Novo processamento**: nome (obrigatório), descrição e de 1 a 10 CPFs/CNPJs,
  digitados ou importados de CSV/TXT (até 50 KB; segunda coluna opcional: 1 = PF,
  0 = PJ). Valida os dígitos verificadores e ignora duplicados e linhas inválidas.
- **Detalhes**: espaço, datas, referência externa, documentos e problemas. Quando o
  envio falhou, aparece o botão **Reenviar**.
- Estados de carregamento, lista vazia e erro de API (com *Tentar novamente*).

## API simulada (modo `mock`, padrão)

Roda inteira no navegador (`static/js/api-mock.js`). Começa com os 8 processamentos do
protótipo; o que você criar fica no `localStorage` e sobrevive ao F5. Os criados aqui
andam sozinhos: **Na fila (12 s) → Processando (30 s) → desfecho**. Os 8 do protótipo
ficam parados. O "Teta Construções" (falha no envio) serve para testar o **Reenviar**.

Opções pela URL, só no modo mock:

| Parâmetro | Padrão | Efeito |
|---|---|---|
| `mock_fila` | `12` | segundos em "Na fila" |
| `mock_proc` | `30` | segundos em "Processando" |
| `mock_desfecho` | `aleatorio` | `concluido`, `alertas`, `erro` ou `aleatorio` (10% erro, 20% alertas, 70% concluído, fixo por ID) |
| `mock_falha` | `0` | de 0 a 1: chance de o envio falhar |
| `mock_atraso` | `150` | latência simulada, em ms |
| `mock_reset` | | `1` apaga o que foi salvo e volta ao protótipo (vale uma vez) |

Exemplo: `/processamentos?mock_fila=3&mock_proc=3&mock_desfecho=alertas`

## Ligando nas APIs reais (modo `http`)

```bash
set API_MODO=http
set API_URL_CRIAR=https://.../processamento    # URL da API de processamento
set API_URL_STATUS=https://.../status          # URL da API de status
set CLIENTE_SOLICITANTE=01234                  # 5 primeiros dígitos do CPF do solicitante
set SIGLA_ORGAO=SEFAZ                          # até 10 caracteres
set API_TOKEN=...                              # veja "Token" abaixo
python app.py
```

O servidor não sobe em modo `http` se alguma dessas variáveis faltar ou for inválida. As
URLs podem ser relativas (`/api/...`, com proxy reverso) ou absolutas; no segundo caso a
origem delas é liberada na CSP, e as APIs precisam aceitar CORS, inclusive o cabeçalho
`Authentication` (a requisição tem pré-voo, por causa dele).

### Contrato implementado

**API de processamento** (cria): `GET` em `API_URL_CRIAR`, header `Authentication: Bearer <TOKEN>`

| Parâmetro | Valor enviado |
|---|---|
| `nomeProcessamento` | nome digitado |
| `descricao` | descrição digitada (pode ser vazia) |
| `listaDocumento` | `00000000000\|1,00000000000000\|0`: documento, `\|`, tipo (1 = CPF, 0 = CNPJ) |
| `clienteSolicitante` | `CLIENTE_SOLICITANTE` (5 dígitos, texto, para não perder zeros à esquerda) |
| `siglaOrgaoSolicitante` | `SIGLA_ORGAO` (até 10 caracteres) |

Retorno: `200 { idProcessamento, dataCadastro, codStatus, status }`, `500` erro, `409`
autenticação falhou (401/403 recebem o mesmo tratamento).

**API de status**: `GET` em `API_URL_STATUS`, `listaIdProcessamento=1,2,3` (em lotes de até
50 ids), mesmo header. Retorno: lista de `{ idProcessamento, codStatus, status,
dataCadastro, dataInicioProcessamento, dataFim }`.

### Como a tela usa essas duas APIs

- **Não há API de listagem.** A lista é guardada no `localStorage` do navegador: cada
  processamento criado entra nela, e a API de status atualiza status e datas. Por isso
  **cada navegador só vê o que foi criado nele** (sem a lista dos outros usuários) e
  limpar os dados do site apaga a lista.
- A API de status só é consultada para processamentos ainda não finalizados
  (finalizados: Concluído, Concluído com alertas, Erro, Cancelado).
- **409** ao criar: mostra "Autenticação falhou" no próprio formulário e nada é salvo.
  **500 ou sem resposta**: o processamento é registrado como *Falha no envio*, com o botão
  **Reenviar** (que chama a API de criação de novo com os mesmos dados).
- Datas `yyyymmdd_hhmm` são lidas como **horário de Brasília**; a tela mostra sem segundos.
- Campos que a API não fornece (Espaço QlikSense, Referência externa) ficam escondidos
  nos detalhes; aparece o **Órgão solicitante**. A API de status não devolve problemas por
  documento: para *Erro* e *Concluído com alertas* a tela mostra só um aviso genérico.

### Status: o que está assumido

A documentação só diz que o status inicial é `NA FILA`. A tela reconhece, pelo **texto**
do status (sem acento, tanto faz maiúsculas): `NA FILA`, `RECEBIDO`, `PROCESSANDO`,
`CONCLUIDO`, `CONCLUIDO COM ALERTAS`, `ERRO` e `CANCELADO`. Qualquer outro texto aparece
como veio da API, em cinza, e conta só em "Todos". Quando os `codStatus` forem conhecidos,
preencha `CODIGOS_STATUS` em `static/js/api-http.js` (tem prioridade sobre o texto).

### Token

O token vai no header `Authentication: Bearer ...`. Há **dois** jeitos de fornecê-lo, ambos
em `api-http.js` (`obterToken`):

1. `API_TOKEN` no servidor: o valor é colocado no HTML da página (`data-api-token`), então
   **qualquer pessoa que abrir a tela o vê**. Serve para desenvolvimento e homologação.
2. Em produção, o ideal é o token vir do login/SSO do usuário, ou de um proxy que o
   acrescenta no servidor. Para isso, passe um `obterToken()` em `criarApi` (`main.js`).

## Para a equipe do back-end

- A API de criação é um `GET` com tudo na URL: **CPFs, CNPJs, nome e descrição ficam em
  logs de acesso, histórico do navegador e proxies**. Vale considerar um `POST` com corpo
  JSON (a tela muda só em `api-http.js`, função `get`).
- Não há chave de idempotência. Se uma criação der `500`/timeout mas a API tiver gravado,
  o **Reenviar** pode criar um processamento duplicado.
- Uma API de listagem (por usuário/órgão) permitiria mostrar o histórico de todos.

## Segurança

- Todo texto vindo da API entra na tela por `textContent`, nunca como HTML.
- Nenhum `style=`/`<script>` inline, o que permite a CSP restrita
  (`script-src 'self'; style-src 'self'`). O servidor não usa sessão nem formulários,
  então não há CSRF do lado do Flask.
- A validação de CPF/CNPJ no navegador é só para retorno imediato; a API deve revalidar.
- Não há login: o usuário vem de `USUARIO_ATUAL`. Autenticação é da aplicação que
  hospedar essa tela.

## Testes

```bash
node --test                          # validadores, formatação e API simulada (Node 20+)
python -m unittest discover -s tests # servidor Flask, CSP e ids usados pelo JS
python tests/e2e_playwright.py       # navegador real, modos mock e http (opcional)
```

O e2e exige `pip install playwright && playwright install chromium` e salva capturas
de tela em `e2e-capturas/`.

## Estrutura

```
app.py                    Flask: serve a página e define a CSP
templates/                index.html + modais + moldes (<template>) clonados pelo JS
static/style.css          estilos com os valores do protótipo
static/js/main.js         orquestra filtros, polling e eventos
static/js/lista.js        desenha cards, tabela, estados e paginação
static/js/novo.js         diálogo de novo processamento (documentos, importação)
static/js/detalhe.js      diálogo de detalhes e reenvio
static/js/api.js          escolhe mock ou http
static/js/api-mock.js     API simulada
static/js/api-http.js     cliente das APIs reais (processamento + status) e lista local
static/js/lista-local.js  filtro, busca e paginação em memória (mock e http)
static/js/validators.js   CPF/CNPJ e validação do formulário
static/js/format.js       datas (Brasília), referência, paginação
static/js/constantes.js   status, filtros, limites
tests/                    node:test (inclui o contrato HTTP), unittest e e2e Playwright
```

O botão *Início* do menu não tem destino, como no protótipo. A seção *Configurações* e o
bloco do usuário no rodapé da barra lateral foram removidos a pedido.


## Docker

```bash
cp .env.example .env        # ajuste os valores (API_MODO=mock funciona sem nada)
docker compose up -d --build
# abre em http://localhost:8080  (porta definida por PORTA no .env)
```

Sem compose:

```bash
docker build -t processamentos-front .
docker run -d -p 8080:8000 --env-file .env --read-only --cap-drop ALL processamentos-front
```

- A imagem usa `python:3.13-slim`, roda com gunicorn (porta 8000) como usuário sem privilégios e não grava em disco (`read_only` funciona).
- `GET /healthz` responde `ok` e alimenta o `HEALTHCHECK` da imagem; não depende das APIs externas.
- Com `API_MODO=http`, a configuração incompleta faz o container **não subir** (o motivo aparece em `docker logs`).
- A CSP (`connect-src`) é calculada na inicialização: ao mudar `API_URL_CRIAR`/`API_URL_STATUS`, recrie o container (`docker compose up -d`).
- `API_TOKEN` vai dentro do HTML. Use só em homologação; em produção, coloque TLS/proxy reverso na frente e obtenha o token por login ou pelo proxy.
- A imagem não guarda estado: a lista de processamentos fica no navegador de cada usuário.
- Teste de imagem: o `docker build` não pôde ser executado onde isto foi escrito (sem daemon); o gunicorn foi validado com os mesmos arquivos e comandos da imagem. Rode `docker compose up --build` uma vez na sua máquina para confirmar.
