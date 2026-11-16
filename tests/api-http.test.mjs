import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../static/js/api-erro.js';
import {
  CHAVE_ARMAZEM, MSG_AUTH, criarCliente, mapearStatus, montarListaDocumento, parseDataApi,
} from '../static/js/api-http.js';
import { infoStatus } from '../static/js/constantes.js';

const CPF = '52998224725';
const CNPJ = '11222333000181';

const resp = (status, corpo) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo });

function memoria() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/**
 * Cliente com fetch falso. `responder(url, opts, chamadas)` devolve a resposta (ou lança, para simular rede fora).
 * Por padrão: API de processamento aceita e numera a partir de 100; API de status devolve a lista de `statusPor`.
 */
function novo({ responder, extra = {}, storage = memoria() } = {}) {
  const chamadas = [];
  let proximo = 100;
  const padrao = (url) => {
    if (url.pathname === '/api/processamento') {
      return resp(200, { idProcessamento: proximo++, dataCadastro: '20261028_1000', codStatus: 1, status: 'NA FILA' });
    }
    return resp(200, []);
  };
  const fetch = async (url, opts) => {
    const u = new URL(url);
    chamadas.push({ url: u, opts });
    return (responder || padrao)(u, opts, padrao);
  };
  const api = criarCliente({
    urlCriar: 'https://api.exemplo.com.br/api/processamento'.replace('https://api.exemplo.com.br', ''),
    urlStatus: '/api/status',
    token: 'tok123',
    clienteSolicitante: '01234',
    siglaOrgao: 'SEFAZ',
    usuario: 'ana.souza',
    ...extra,
  }, { fetch, storage, agora: () => new Date('2026-10-28T13:00:00Z'), origem: 'http://localhost' });
  return { api, chamadas, storage };
}

const novoProc = (nome = 'Teste', docs = [{ numero: CPF, origem: 'Manual' }, { numero: CNPJ, origem: 'Arquivo' }]) => ({ nome, descricao: 'desc', docs });

// ---------- formatos ----------

test('listaDocumento: 1 = CPF, 0 = CNPJ', () => {
  assert.equal(montarListaDocumento([{ numero: CPF }, { numero: CNPJ }]), `${CPF}|1,${CNPJ}|0`);
  assert.equal(montarListaDocumento([{ numero: CNPJ }]), `${CNPJ}|0`);
});

test('datas yyyymmdd_hhmm', () => {
  assert.equal(parseDataApi('20261028_1000'), '2026-10-28T10:00:00-03:00');
  assert.equal(parseDataApi('20261231_2359'), '2026-12-31T23:59:00-03:00');
  for (const ruim of [null, undefined, '', '00000000_0000', '20261328_1000', '2026-10-28', '20261028_10', 20261028]) {
    assert.equal(parseDataApi(ruim), null, String(ruim));
  }
});

test('status: texto da API vira chave interna; desconhecido vira OUTRO com o texto original', () => {
  assert.deepEqual(mapearStatus(1, 'NA FILA'), { status: 'NA_FILA', statusRotulo: 'NA FILA' });
  assert.equal(mapearStatus(2, 'Concluído').status, 'CONCLUIDO');
  assert.equal(mapearStatus(3, 'concluido_com_alertas').status, 'CONCLUIDO_COM_ALERTAS');
  const x = mapearStatus(99, 'EM ANÁLISE');
  assert.deepEqual(x, { status: 'OUTRO', statusRotulo: 'EM ANÁLISE' });
  assert.deepEqual(infoStatus(x), ['EM ANÁLISE', 'gray']);
  assert.deepEqual(infoStatus({ status: 'NA_FILA' }), ['Na fila', 'blue']);
  assert.equal(mapearStatus('constructor', 'toString').status, 'OUTRO'); // sem herança de Object.prototype
});

// ---------- criar ----------

test('criar: monta a requisição GET conforme o contrato', async () => {
  const { api, chamadas, storage } = novo();
  const p = await api.criar(novoProc('Due diligence — Ômega'));

  assert.equal(chamadas.length, 1);
  const { url, opts } = chamadas[0];
  assert.equal(opts.method, 'GET');
  assert.equal(opts.body, undefined);
  assert.equal(opts.credentials, 'omit');
  assert.equal(opts.headers.Authentication, 'Bearer tok123');
  assert.equal(url.pathname, '/api/processamento');
  assert.equal(url.searchParams.get('nomeProcessamento'), 'Due diligence — Ômega');
  assert.equal(url.searchParams.get('descricao'), 'desc');
  assert.equal(url.searchParams.get('listaDocumento'), `${CPF}|1,${CNPJ}|0`);
  assert.equal(url.searchParams.get('clienteSolicitante'), '01234'); // zeros à esquerda preservados
  assert.equal(url.searchParams.get('siglaOrgaoSolicitante'), 'SEFAZ');

  assert.equal(p.idTrovale, 100);
  assert.equal(p.status, 'NA_FILA');
  assert.equal(p.cadastro, '2026-10-28T10:00:00-03:00');
  assert.equal(p.usuario, 'ana.souza');
  assert.equal(p.siglaOrgao, 'SEFAZ');
  assert.equal(p.qtdDocs, 2);
  assert.ok(storage.getItem(CHAVE_ARMAZEM)); // ficou guardado para a lista
});

test('criar: sem token não envia o cabeçalho', async () => {
  const { api, chamadas } = novo({ extra: { token: '' } });
  await api.criar(novoProc());
  assert.ok(!('Authentication' in chamadas[0].opts.headers));
});

test('criar: valida antes de chamar a API (422)', async () => {
  const { api, chamadas } = novo();
  await assert.rejects(api.criar({ nome: '', docs: [] }), (e) => e instanceof ApiError && e.status === 422 && !!e.erros.nome && !!e.erros.docs);
  assert.equal(chamadas.length, 0);
});

test('criar: 409 = autenticação falhou, nada é salvo', async () => {
  const { api, storage } = novo({ responder: () => resp(409, {}) });
  await assert.rejects(api.criar(novoProc()), (e) => e instanceof ApiError && e.status === 409 && e.message === MSG_AUTH);
  const lista = await api.listar();
  assert.equal(lista.total, 0);
  assert.ok(!JSON.parse(storage.getItem(CHAVE_ARMAZEM) || '[]').length);
});

test('criar: 500 e rede fora registram FALHA_ENVIO com problema', async () => {
  const quinhentos = novo({ responder: () => resp(500, {}) });
  const a = await quinhentos.api.criar(novoProc('A'));
  assert.equal(a.status, 'FALHA_ENVIO');
  assert.equal(a.idTrovale, null);
  assert.equal(a.problemas[0].codigo, 'ENVIO_ERRO_API');

  const semRede = novo({ responder: () => { throw new TypeError('Failed to fetch'); } });
  const b = await semRede.api.criar(novoProc('B'));
  assert.equal(b.status, 'FALHA_ENVIO');
  assert.equal(b.problemas[0].codigo, 'ENVIO_SEM_RESPOSTA');
  assert.equal((await semRede.api.listar({ filtro: 'problema' })).total, 1);

  const semId = novo({ responder: () => resp(200, { status: 'NA FILA' }) });
  assert.equal((await semId.api.criar(novoProc('C'))).status, 'FALHA_ENVIO');
});

test('reenviar: só com falha de envio; reaproveita os dados e volta para a fila', async () => {
  let modo = 500;
  const { api, chamadas } = novo({
    responder: (u, o, padrao) => (u.pathname === '/api/processamento' && modo !== 200 ? resp(modo, {}) : padrao(u)),
  });
  const falhou = await api.criar(novoProc('Vai falhar'));
  assert.equal(falhou.status, 'FALHA_ENVIO');

  await assert.rejects(api.reenviar(falhou.id), (e) => e.status === 502); // API ainda fora
  modo = 409;
  await assert.rejects(api.reenviar(falhou.id), (e) => e.status === 409 && e.message === MSG_AUTH);
  modo = 200;
  const ok = await api.reenviar(falhou.id);
  assert.equal(ok.status, 'NA_FILA');
  assert.equal(ok.idTrovale, 100);
  assert.deepEqual(ok.problemas, []);
  assert.equal(chamadas.at(-1).url.searchParams.get('nomeProcessamento'), 'Vai falhar');
  assert.equal(chamadas.at(-1).url.searchParams.get('listaDocumento'), `${CPF}|1,${CNPJ}|0`);

  await assert.rejects(api.reenviar(falhou.id), (e) => e.status === 409); // já foi
  await assert.rejects(api.reenviar(9999), (e) => e.status === 404);
});

// ---------- status ----------

function statusDa(tabela) {
  // tabela: { id: [codStatus, status, cadastro, inicio, fim] }
  return (u, o, padrao) => {
    if (u.pathname !== '/api/status') return padrao(u);
    const ids = u.searchParams.get('listaIdProcessamento').split(',').map(Number);
    return resp(200, ids.filter((i) => tabela[i]).map((i) => {
      const [cod, status, cad, ini, fim] = tabela[i];
      return { idProcessamento: i, codStatus: cod, status, dataCadastro: cad, dataInicioProcessamento: ini, dataFim: fim };
    }));
  };
}

test('listar: consulta a API de status em lote e atualiza status e datas', async () => {
  const tabela = {};
  const { api, chamadas } = novo({ responder: (u, o, p) => statusDa(tabela)(u, o, p) });
  await api.criar(novoProc('Primeiro')); // id 100
  await api.criar(novoProc('Segundo'));  // id 101

  tabela[100] = [2, 'PROCESSANDO', '20261028_1000', '20261028_1005', ''];
  tabela[101] = [3, 'CONCLUÍDO', '20261028_1001', '20261028_1006', '20261028_1030'];
  const lista = await api.listar();

  const chamadasStatus = chamadas.filter((c) => c.url.pathname === '/api/status');
  assert.equal(chamadasStatus.length, 1);
  assert.equal(chamadasStatus[0].url.searchParams.get('listaIdProcessamento'), '100,101');
  assert.equal(chamadasStatus[0].opts.headers.Authentication, 'Bearer tok123');

  const por = Object.fromEntries(lista.itens.map((i) => [i.nome, i]));
  assert.equal(por.Primeiro.status, 'PROCESSANDO');
  assert.equal(por.Primeiro.inicio, '2026-10-28T10:05:00-03:00');
  assert.equal(por.Primeiro.fim, null);
  assert.equal(por.Segundo.status, 'CONCLUIDO');
  assert.equal(por.Segundo.fim, '2026-10-28T10:30:00-03:00');
  assert.deepEqual(lista.contagem, { todos: 2, fila: 0, processando: 1, concluidos: 1, problema: 0 });
  assert.equal(lista.sincronizado, undefined);

  // o concluído é final: na próxima consulta só o 100 vai para a API
  await api.listar();
  const ultima = chamadas.filter((c) => c.url.pathname === '/api/status').at(-1);
  assert.equal(ultima.url.searchParams.get('listaIdProcessamento'), '100');
});

test('listar: status desconhecido continua sendo consultado e aparece com o texto da API', async () => {
  const tabela = { 100: [77, 'EM ANÁLISE', '20261028_1000', '', ''] };
  const { api, chamadas } = novo({ responder: (u, o, p) => statusDa(tabela)(u, o, p) });
  await api.criar(novoProc());
  const item = (await api.listar()).itens[0];
  assert.equal(item.status, 'OUTRO');
  assert.deepEqual(infoStatus(item), ['EM ANÁLISE', 'gray']);
  await api.listar();
  assert.equal(chamadas.filter((c) => c.url.pathname === '/api/status').length, 2);
});

test('ERRO e CONCLUÍDO COM ALERTAS ganham um problema explicando o que a API informou', async () => {
  const tabela = { 100: [4, 'ERRO', '20261028_1000', '20261028_1001', '20261028_1002'], 101: [5, 'CONCLUIDO COM ALERTAS', '20261028_1000', '', ''] };
  const { api } = novo({ responder: (u, o, p) => statusDa(tabela)(u, o, p) });
  await api.criar(novoProc('E'));
  await api.criar(novoProc('A'));
  await api.listar();
  assert.equal((await api.obter(1)).problemas[0].severidade, 'ERRO');
  assert.equal((await api.obter(2)).problemas[0].severidade, 'ALERTA');
});

test('listar: falha na API de status mantém os dados salvos e avisa', async () => {
  let modo = 200;
  const { api } = novo({ responder: (u, o, p) => (u.pathname === '/api/status' && modo !== 200 ? resp(modo, {}) : p(u)) });
  await api.criar(novoProc());

  modo = 500;
  let r = await api.listar();
  assert.equal(r.total, 1);
  assert.equal(r.sincronizado, false);
  assert.match(r.aviso, /Não foi possível consultar/);

  modo = 409;
  r = await api.listar();
  assert.equal(r.aviso, MSG_AUTH);

  const semRede = novo({ responder: (u, o, p) => { if (u.pathname === '/api/status') throw new TypeError('x'); return p(u); } });
  await semRede.api.criar(novoProc());
  assert.equal((await semRede.api.listar()).sincronizado, false);
});

test('listar: consulta em lotes de 50 ids', async () => {
  const storage = memoria();
  const itens = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1, idTrovale: 1000 + i, nome: `P${i}`, descricao: '', usuario: 'ana.souza', espaco: null, status: 'NA_FILA',
    statusRotulo: 'NA FILA', cadastro: '2026-10-28T10:00:00-03:00', inicio: null, fim: null,
    docs: [{ numero: CPF, origem: 'Manual' }], problemas: [],
  }));
  storage.setItem(CHAVE_ARMAZEM, JSON.stringify(itens));
  const { api, chamadas } = novo({ storage });
  await api.listar();
  const lotes = chamadas.filter((c) => c.url.pathname === '/api/status')
    .map((c) => c.url.searchParams.get('listaIdProcessamento').split(',').length);
  assert.deepEqual(lotes, [50, 50, 20]);
});

test('status API: aceita a lista dentro de um objeto e ignora ids desconhecidos', async () => {
  const { api } = novo({
    responder: (u, o, p) => (u.pathname === '/api/status'
      ? resp(200, { resultado: [{ idProcessamento: 999, codStatus: 1, status: 'NA FILA' }, { idProcessamento: 100, codStatus: 3, status: 'CONCLUIDO', dataCadastro: '20261028_1000' }] })
      : p(u)),
  });
  await api.criar(novoProc());
  const r = await api.listar();
  assert.equal(r.itens[0].status, 'CONCLUIDO');
  assert.equal(r.total, 1);
});

test('obter: atualiza só aquele processamento e dá 404 se não existir', async () => {
  const tabela = { 100: [2, 'PROCESSANDO', '20261028_1000', '20261028_1003', ''] };
  const { api, chamadas } = novo({ responder: (u, o, p) => statusDa(tabela)(u, o, p) });
  await api.criar(novoProc('A'));
  await api.criar(novoProc('B'));
  const a = await api.obter(1);
  assert.equal(a.status, 'PROCESSANDO');
  assert.equal(chamadas.filter((c) => c.url.pathname === '/api/status').at(-1).url.searchParams.get('listaIdProcessamento'), '100');
  await assert.rejects(api.obter(999), (e) => e.status === 404);
});

test('a lista sobrevive a um novo cliente (F5) e ignora armazenamento corrompido', async () => {
  const storage = memoria();
  const a = novo({ storage });
  await a.api.criar(novoProc('Persistido'));
  const b = novo({ storage });
  assert.equal((await b.api.listar()).itens[0].nome, 'Persistido');

  storage.setItem(CHAVE_ARMAZEM, '{isso não é json');
  assert.equal((await novo({ storage }).api.listar()).total, 0);
});

test('busca por ID Trovale e filtro por usuário funcionam sobre a lista local', async () => {
  const { api } = novo();
  await api.criar(novoProc('Alfa'));
  await api.criar(novoProc('Beta'));
  assert.equal((await api.listar({ q: '101' })).itens[0].nome, 'Beta');
  assert.equal((await api.listar({ usuario: 'outra.pessoa' })).total, 0);
  assert.deepEqual((await api.listar()).usuarios, ['ana.souza']);
});
