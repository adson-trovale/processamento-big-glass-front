/**
 * API simulada, 100% no navegador. Segue o mesmo contrato de api-http.js.
 *
 * - Começa com os 8 processamentos do protótipo e guarda o que você criar no
 *   localStorage (sobrevive ao F5).
 * - Processamentos criados aqui andam sozinhos: Na fila -> Processando -> desfecho.
 *
 * Opções pela URL (só no modo mock), úteis para demonstrar e testar:
 *   ?mock_fila=12        segundos em "Na fila"                (padrão 12)
 *   ?mock_proc=30        segundos em "Processando"            (padrão 30)
 *   ?mock_desfecho=...   concluido | alertas | erro | aleatorio (padrão aleatorio)
 *   ?mock_falha=0..1     chance de o envio falhar             (padrão 0)
 *   ?mock_atraso=150     latência simulada em ms              (padrão 150)
 *   ?mock_reset=1        apaga o que foi salvo e volta ao protótipo
 */
import { ApiError } from './api-erro.js';
import { referencia } from './format.js';
import { consultar, visao as visaoBase } from './lista-local.js';
import { validarProcessamento } from './validators.js';

const CHAVE = 'big-glass:processamentos-mock:v1';
const MSG_FALHA_ENVIO =
  'A API Trovale não respondeu após 3 tentativas. Reenvie; a mesma Idempotency-Key evita duplicidade.';

const p = (id, idTrovale, nome, descricao, usuario, espaco, status, cadastro, inicio, fim, docs, problemas = []) => ({
  id, idTrovale, nome, descricao, usuario, espaco, status,
  cadastro, inicio, fim,
  docs: docs.map((numero) => ({ numero, origem: 'Manual' })),
  problemas, sim: false,
});

const SEMENTE = [
  p(131, 24861, 'Due diligence — Alfa Transportes', 'Análise de vínculos para contratação de transportadora',
    'ana.souza', 'TROVALE_1510', 'NA_FILA', '2026-10-27T14:02:10-03:00', null, null,
    ['11222333000181', '52998224725']),
  p(130, 24860, 'Reabertura OS 0232 — Supermercado Beta', 'Reanálise solicitada pelo jurídico',
    'wesley.lima', 'TROVALE_1510', 'NA_FILA', '2026-10-27T13:58:41-03:00', null, null,
    ['12345678000195', '11144477735', '39053344705']),
  p(129, 24859, 'Vínculos societários — Gama Química', 'Mapeamento de sócios e empresas ligadas',
    'ana.souza', 'TROVALE_1620', 'PROCESSANDO', '2026-10-27T13:40:02-03:00', '2026-10-27T13:52:15-03:00', null,
    ['45723174000110', '12345678909']),
  p(128, 24858, 'Fornecedor novo — Delta Reciclagem', 'Homologação de fornecedor',
    'ana.souza', 'TROVALE_1510', 'CONCLUIDO', '2026-10-27T11:32:10-03:00', '2026-10-27T11:33:04-03:00', '2026-10-27T12:48:04-03:00',
    ['19131243000197']),
  p(127, 24857, 'Treinamento — Épsilon Geradores', 'Turma de treinamento de analistas',
    'wesley.lima', 'TROVALE_TREINAMENTO', 'CONCLUIDO_COM_ALERTAS', '2026-10-27T10:05:22-03:00',
    '2026-10-27T10:12:40-03:00', '2026-10-27T10:58:11-03:00',
    ['60701190000104', '11144477735', '93541134780'],
    [{ codigo: 'DOC_SEM_VINCULO', severidade: 'ALERTA', documento: '93541134780', mensagem: 'Nenhum vínculo encontrado para o documento.' }]),
  p(126, 24856, 'Reabertura OS 0255 — Zeta Café', 'Reabertura a pedido do cliente',
    'ana.souza', 'TROVALE_1510', 'ERRO', '2026-10-27T09:20:37-03:00', '2026-10-27T09:31:02-03:00', '2026-10-27T09:47:55-03:00',
    ['33000167000101', '52998224725'],
    [{ codigo: 'FONTE_INDISPONIVEL', severidade: 'ERRO', documento: '', mensagem: 'Fonte externa fora do ar durante o processamento. Solicite novamente.' }]),
  p(125, null, 'Análise — Teta Construções', 'Pedido do comercial',
    'ana.souza', 'TROVALE_1510', 'FALHA_ENVIO', '2026-10-27T08:44:19-03:00', null, null,
    ['11222333000181'],
    [{ codigo: 'ENVIO_SEM_RESPOSTA', severidade: 'ERRO', documento: '', mensagem: MSG_FALHA_ENVIO }]),
  p(124, 24855, 'Cliente — Eta Engenharia', 'Cancelado a pedido da operação',
    'wesley.lima', 'TROVALE_1620', 'CANCELADO', '2026-10-26T17:10:17-03:00', null, null,
    ['12345678000195']),
];

export function lerOpcoes(search = (typeof location !== 'undefined' ? location.search : '')) {
  const q = new URLSearchParams(search);
  const num = (nome, padrao) => {
    const v = parseFloat(q.get(nome));
    return Number.isFinite(v) ? v : padrao;
  };
  return {
    segFila: num('mock_fila', 12),
    segProc: num('mock_proc', 30),
    desfecho: q.get('mock_desfecho') || 'aleatorio',
    taxaFalha: num('mock_falha', 0),
    atrasoMs: num('mock_atraso', 150),
    reset: q.get('mock_reset') === '1',
  };
}

const copia = (x) => JSON.parse(JSON.stringify(x));
const esperar = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function lerArmazenado() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) return JSON.parse(bruto);
  } catch (e) { /* sem localStorage ou conteúdo inválido */ }
  return null;
}

function gravarArmazenado(itens) {
  try { localStorage.setItem(CHAVE, JSON.stringify(itens)); } catch (e) { /* ok: segue em memória */ }
}

function novaChave() {
  return globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function criarCliente(opcoes = lerOpcoes(), usuarioAtual = 'ana.souza') {
  if (opcoes.reset) {
    try { localStorage.removeItem(CHAVE); } catch (e) { /* ok */ }
  }
  let itens = lerArmazenado() || copia(SEMENTE);
  const salvar = () => gravarArmazenado(itens);

  const proximoId = () => Math.max(0, ...itens.map((i) => i.id)) + 1;
  const proximoIdTrovale = () => Math.max(24861, ...itens.map((i) => i.idTrovale || 0)) + 1;

  function desfechoDe(item) {
    if (['concluido', 'alertas', 'erro'].includes(opcoes.desfecho)) return opcoes.desfecho;
    const m = item.idTrovale % 10; // determinístico por ID
    if (m === 0) return 'erro';
    return m <= 2 ? 'alertas' : 'concluido';
  }

  function finalizar(item, fimMs) {
    item.fim = new Date(fimMs).toISOString();
    const desfecho = desfechoDe(item);
    if (desfecho === 'erro') {
      item.status = 'ERRO';
      item.problemas = [{
        codigo: 'FONTE_INDISPONIVEL', severidade: 'ERRO', documento: '',
        mensagem: 'Fonte externa fora do ar durante o processamento. Solicite novamente.',
      }];
    } else if (desfecho === 'alertas') {
      item.status = 'CONCLUIDO_COM_ALERTAS';
      const doc = item.docs[item.idTrovale % item.docs.length].numero;
      item.problemas = [{
        codigo: 'DOC_SEM_VINCULO', severidade: 'ALERTA', documento: doc,
        mensagem: 'Nenhum vínculo encontrado para o documento.',
      }];
    } else {
      item.status = 'CONCLUIDO';
      item.problemas = [];
    }
  }

  /** Faz os processamentos criados aqui andarem conforme o tempo. */
  function avancar() {
    const agora = Date.now();
    let mudou = false;
    for (const item of itens) {
      if (!item.sim || !item.idTrovale || !item.enviadoEm) continue;
      const enviado = Date.parse(item.enviadoEm);
      const decorrido = (agora - enviado) / 1000;
      if (item.status === 'NA_FILA' && decorrido >= opcoes.segFila) {
        item.status = 'PROCESSANDO';
        item.inicio = new Date(enviado + opcoes.segFila * 1000).toISOString();
        mudou = true;
      }
      if (item.status === 'PROCESSANDO' && decorrido >= opcoes.segFila + opcoes.segProc) {
        finalizar(item, enviado + (opcoes.segFila + opcoes.segProc) * 1000);
        mudou = true;
      }
    }
    if (mudou) salvar();
  }

  /** Simula o envio à API; devolve true se foi aceito. */
  function enviar(item) {
    if (Math.random() < opcoes.taxaFalha) {
      item.status = 'FALHA_ENVIO';
      item.idTrovale = null;
      item.problemas = [{ codigo: 'ENVIO_SEM_RESPOSTA', severidade: 'ERRO', documento: '', mensagem: MSG_FALHA_ENVIO }];
      return false;
    }
    if (!item.idTrovale) item.idTrovale = proximoIdTrovale(); // mesma Idempotency-Key: não duplica
    item.status = 'NA_FILA';
    item.problemas = [];
    item.inicio = null;
    item.fim = null;
    item.enviadoEm = new Date().toISOString();
    return true;
  }

  const visao = (item) => ({ ...visaoBase(item), referencia: referencia(item.id) });

  return {
    async listar({ filtro = 'todos', usuario = 'todos', q = '', pagina = 1, porPagina = 10 } = {}) {
      await esperar(opcoes.atrasoMs);
      avancar();

      return consultar(itens, { filtro, usuario, q, pagina, porPagina }, visao);
    },

    async obter(id) {
      await esperar(opcoes.atrasoMs);
      avancar();
      const item = itens.find((i) => i.id === Number(id));
      if (!item) throw new ApiError(404, { erro: 'Processamento não encontrado.' });
      return visao(item);
    },

    async criar(payload) {
      await esperar(opcoes.atrasoMs);
      const { dados, erros } = validarProcessamento(payload);
      if (erros && Object.keys(erros).length) throw new ApiError(422, { erros });

      const item = {
        id: proximoId(), idTrovale: null,
        nome: dados.nome, descricao: dados.descricao,
        usuario: usuarioAtual, espaco: 'TROVALE_1510',
        status: 'PENDENTE_ENVIO', cadastro: new Date().toISOString(),
        inicio: null, fim: null, docs: dados.docs, problemas: [],
        sim: true, idempotencyKey: novaChave(),
      };
      itens.push(item);
      enviar(item);
      salvar();
      return visao(item);
    },

    async reenviar(id) {
      await esperar(opcoes.atrasoMs);
      const item = itens.find((i) => i.id === Number(id));
      if (!item) throw new ApiError(404, { erro: 'Processamento não encontrado.' });
      if (item.status !== 'FALHA_ENVIO') {
        throw new ApiError(409, { erro: 'Só é possível reenviar processamentos com falha no envio.' });
      }
      item.sim = true; // a partir de agora ele anda sozinho, como os criados aqui
      const aceito = enviar(item);
      salvar();
      if (!aceito) throw new ApiError(502, { erro: 'A API Trovale continua sem responder. Tente novamente em instantes.' });
      return visao(item);
    },
  };
}
