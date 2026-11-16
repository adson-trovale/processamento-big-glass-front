import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../static/js/api-erro.js';
import { criarCliente, lerOpcoes } from '../static/js/api-mock.js';
import { definirPrecisao, fmtDataHora, janelaPaginas, referencia } from '../static/js/format.js';
import {
  cnpjValido, cpfValido, fmtDoc, soDigitos, validarDoc, validarProcessamento,
} from '../static/js/validators.js';

const CPF = '52998224725';
const CNPJ = '11222333000181';

// API simulada sem latência e sem persistência entre testes (não há localStorage no Node).
const novoMock = (extra = {}) => criarCliente(
  { segFila: 3600, segProc: 3600, desfecho: 'aleatorio', taxaFalha: 0, atrasoMs: 0, reset: false, ...extra },
  'ana.souza',
);

// ---------- validadores ----------

test('CPF e CNPJ', () => {
  for (const ok of ['52998224725', '11144477735', '39053344705', '12345678909']) assert.ok(cpfValido(ok), ok);
  for (const ruim of ['11144477700', '11111111111', '123', '5299822472']) assert.ok(!cpfValido(ruim), ruim);
  for (const ok of ['11222333000181', '12345678000195', '45723174000110', '19131243000197']) assert.ok(cnpjValido(ok), ok);
  for (const ruim of ['11222333000100', '00000000000000', '1122233300018']) assert.ok(!cnpjValido(ruim), ruim);
});

test('mensagens de validação de documento', () => {
  assert.equal(validarDoc(CPF), null);
  assert.match(validarDoc('11144477700'), /CPF inválido/);
  assert.match(validarDoc('11222333000100'), /CNPJ inválido/);
  assert.match(validarDoc('123'), /11 dígitos/);
});

test('formatação de documentos', () => {
  assert.equal(soDigitos('529.982.247-25'), CPF);
  assert.equal(soDigitos(null), '');
  assert.equal(fmtDoc(CPF), '529.982.247-25');
  assert.equal(fmtDoc(CNPJ), '11.222.333/0001-81');
});

test('validarProcessamento', () => {
  let r = validarProcessamento({ nome: '  Teste ', descricao: '', docs: [{ numero: '529.982.247-25', origem: 'Arquivo' }] });
  assert.deepEqual(r.erros, {});
  assert.deepEqual(r.dados, { nome: 'Teste', descricao: '', docs: [{ numero: CPF, origem: 'Arquivo' }] });

  r = validarProcessamento({ nome: '', docs: [] });
  assert.deepEqual(Object.keys(r.erros).sort(), ['docs', 'nome']);

  r = validarProcessamento({ nome: 'x', docs: [{ numero: CPF }, { numero: CPF }] });
  assert.match(r.erros.docs, /duplicado/);

  r = validarProcessamento({ nome: 'x', docs: Array(11).fill({ numero: CNPJ }) });
  assert.match(r.erros.docs, /Limite/);

  r = validarProcessamento({ nome: 'x'.repeat(121), descricao: 'd'.repeat(501), docs: [{ numero: CPF }] });
  assert.deepEqual(Object.keys(r.erros).sort(), ['descricao', 'nome']);

  assert.ok(validarProcessamento(['lixo']).erros.geral);
  assert.equal(validarProcessamento({ nome: 'x', docs: [{ numero: CPF, origem: 'Hack' }] }).dados.docs[0].origem, 'Manual');
});

// ---------- formatação ----------

test('datas em horário de Brasília e referência', () => {
  assert.equal(fmtDataHora('2026-10-27T14:02:10-03:00'), '27/10/2026 14:02:10');
  assert.equal(fmtDataHora('2026-10-27T17:02:10Z'), '27/10/2026 14:02:10');
  assert.equal(fmtDataHora('2026-10-27T00:05:00-03:00'), '27/10/2026 00:05:00'); // meia-noite não vira "24"
  assert.equal(fmtDataHora(null), '—');
  assert.equal(fmtDataHora('lixo'), '—');
  assert.equal(referencia(132), 'PARC-000132');
});

test('datas sem segundos (a API real só informa até o minuto)', () => {
  definirPrecisao(false);
  try {
    assert.equal(fmtDataHora('2026-10-28T10:00:00-03:00'), '28/10/2026 10:00');
  } finally {
    definirPrecisao(true);
  }
  assert.equal(fmtDataHora('2026-10-28T10:00:00-03:00'), '28/10/2026 10:00:00');
});

test('janela de paginação', () => {
  assert.deepEqual(janelaPaginas(1, 1), [1]);
  assert.deepEqual(janelaPaginas(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(janelaPaginas(1, 20), [1, 2, null, 20]);
  assert.deepEqual(janelaPaginas(10, 20), [1, null, 9, 10, 11, null, 20]);
  assert.deepEqual(janelaPaginas(20, 20), [1, null, 19, 20]);
});

test('opções da API simulada pela URL', () => {
  const o = lerOpcoes('?mock_fila=2&mock_proc=3&mock_desfecho=erro&mock_falha=0.5&mock_atraso=0&mock_reset=1');
  assert.deepEqual(o, { segFila: 2, segProc: 3, desfecho: 'erro', taxaFalha: 0.5, atrasoMs: 0, reset: true });
  assert.deepEqual(lerOpcoes(''), { segFila: 12, segProc: 30, desfecho: 'aleatorio', taxaFalha: 0, atrasoMs: 150, reset: false });
});

// ---------- API simulada ----------

test('mock: lista os 8 processamentos do protótipo, mais novos primeiro', async () => {
  const r = await novoMock().listar();
  assert.equal(r.total, 8);
  assert.equal(r.itens[0].nome, 'Due diligence — Alfa Transportes');
  assert.deepEqual(r.contagem, { todos: 8, fila: 2, processando: 1, concluidos: 2, problema: 3 });
  assert.deepEqual(r.usuarios, ['ana.souza', 'wesley.lima']);
  assert.equal(r.itens[0].qtdDocs, 2);
});

test('mock: filtros, busca e paginação', async () => {
  const api = novoMock();
  assert.equal((await api.listar({ filtro: 'fila' })).total, 2);
  assert.equal((await api.listar({ filtro: 'problema' })).total, 3);
  assert.equal((await api.listar({ usuario: 'wesley.lima' })).total, 3);
  assert.equal((await api.listar({ q: 'épsilon' })).itens[0].idTrovale, 24857);
  assert.equal((await api.listar({ q: 'ÉPSILON' })).total, 1);
  assert.equal((await api.listar({ q: '24859' })).itens[0].nome, 'Vínculos societários — Gama Química');
  assert.equal((await api.listar({ q: '%' })).total, 0);
  assert.equal((await api.listar({ filtro: 'constructor' })).total, 8); // filtro desconhecido = todos

  const pag = await api.listar({ pagina: 99, porPagina: 3 });
  assert.equal(pag.pagina, 3);
  assert.equal(pag.itens.length, 2);
  assert.equal(pag.totalPaginas, 3);
});

test('mock: obter e 404', async () => {
  const api = novoMock();
  const p = await api.obter(127);
  assert.equal(p.problemas[0].codigo, 'DOC_SEM_VINCULO');
  assert.equal(p.docs.length, 3);
  assert.equal(p.referencia, 'PARC-000127');
  await assert.rejects(api.obter(9999), (e) => e instanceof ApiError && e.status === 404);
});

test('mock: criar envia e devolve Na fila com IDs sequenciais', async () => {
  const api = novoMock();
  const a = await api.criar({ nome: 'A', docs: [{ numero: CPF, origem: 'Manual' }, { numero: CNPJ, origem: 'Arquivo' }] });
  const b = await api.criar({ nome: 'B', docs: [{ numero: CPF }] });
  assert.equal(a.status, 'NA_FILA');
  assert.equal(a.idTrovale, 24862);
  assert.equal(a.id, 132);
  assert.equal(b.idTrovale, 24863);
  assert.equal(a.usuario, 'ana.souza');
  assert.equal(a.qtdDocs, 2);
  assert.ok(!('idempotencyKey' in a) && !('sim' in a)); // detalhes internos não vazam

  const lista = await api.listar();
  assert.equal(lista.total, 10);
  assert.equal(lista.itens[0].nome, 'B');
});

test('mock: criar valida e devolve 422 sem gravar', async () => {
  const api = novoMock();
  await assert.rejects(api.criar({ nome: '', docs: [{ numero: '11144477700' }] }), (e) =>
    e instanceof ApiError && e.status === 422 && e.erros.nome && /CPF inválido/.test(e.erros.docs));
  assert.equal((await api.listar()).total, 8);
});

test('mock: andamento por tempo (fila -> processando -> concluído)', async () => {
  const api = novoMock({ segFila: 12, segProc: 30, desfecho: 'concluido' });
  const criado = await api.criar({ nome: 'Andamento', docs: [{ numero: CPF }] });
  const real = Date.now();
  const relogio = mock.method(Date, 'now', () => real);

  assert.equal((await api.obter(criado.id)).status, 'NA_FILA');
  relogio.mock.mockImplementation(() => real + 13_000);
  const meio = await api.obter(criado.id);
  assert.equal(meio.status, 'PROCESSANDO');
  assert.ok(meio.inicio);
  relogio.mock.mockImplementation(() => real + 50_000);
  const fim = await api.obter(criado.id);
  assert.equal(fim.status, 'CONCLUIDO');
  assert.ok(fim.fim);
  relogio.mock.restore();
});

test('mock: desfechos com alerta e com erro', async () => {
  const alertas = novoMock({ segFila: 0, segProc: 0, desfecho: 'alertas' });
  const a = await alertas.criar({ nome: 'A', docs: [{ numero: CPF }, { numero: CNPJ }] });
  const ra = await alertas.obter(a.id);
  assert.equal(ra.status, 'CONCLUIDO_COM_ALERTAS');
  assert.equal(ra.problemas[0].codigo, 'DOC_SEM_VINCULO');
  assert.ok([CPF, CNPJ].includes(ra.problemas[0].documento));

  const erro = novoMock({ segFila: 0, segProc: 0, desfecho: 'erro' });
  const e = await erro.criar({ nome: 'E', docs: [{ numero: CPF }] });
  assert.equal((await erro.obter(e.id)).status, 'ERRO');
});

test('mock: processamentos do protótipo não andam sozinhos', async () => {
  const api = novoMock({ segFila: 0, segProc: 0 });
  await api.listar();
  assert.equal((await api.obter(131)).status, 'NA_FILA');
  assert.equal((await api.obter(129)).status, 'PROCESSANDO');
});

test('mock: falha de envio e reenvio', async () => {
  const api = novoMock({ taxaFalha: 1 });
  const falhou = await api.criar({ nome: 'Vai falhar', docs: [{ numero: CPF }] });
  assert.equal(falhou.status, 'FALHA_ENVIO');
  assert.equal(falhou.idTrovale, null);
  assert.equal(falhou.problemas[0].codigo, 'ENVIO_SEM_RESPOSTA');

  // a API continua fora do ar
  await assert.rejects(api.reenviar(falhou.id), (e) => e instanceof ApiError && e.status === 502);

  // reenvio de um processamento que não falhou
  await assert.rejects(api.reenviar(131), (e) => e instanceof ApiError && e.status === 409);
  await assert.rejects(api.reenviar(9999), (e) => e instanceof ApiError && e.status === 404);
});

test('mock: reenvio aceito usa um único ID Trovale', async () => {
  const api = novoMock();
  const ok = await api.reenviar(125); // "Teta Construções", falha de envio do protótipo
  assert.equal(ok.status, 'NA_FILA');
  assert.equal(ok.idTrovale, 24862);
  assert.deepEqual(ok.problemas, []);
  await assert.rejects(api.reenviar(125), (e) => e.status === 409);
});
