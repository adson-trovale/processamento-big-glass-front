/**
 * Cliente das APIs reais (BIG GLASS / Trovale).
 *
 * API de processamento (cria um processamento) — GET
 *   entrada : nomeProcessamento, descricao,
 *             listaDocumento  "00000000000|1,00000000000000|0"   (1 = CPF, 0 = CNPJ)
 *             clienteSolicitante  (5 primeiros dígitos do CPF do solicitante)
 *             siglaOrgaoSolicitante  (até 10 caracteres)
 *   header  : Authentication: Bearer <TOKEN>
 *   retorno : 200 { idProcessamento, dataCadastro "yyyymmdd_hhmm", codStatus, status }
 *             500 erro  |  409 autenticação falhou
 *
 * API de status — GET
 *   entrada : listaIdProcessamento  "1,2,3"
 *   header  : Authentication: Bearer <TOKEN>
 *   retorno : [ { idProcessamento, codStatus, status, dataCadastro,
 *                 dataInicioProcessamento, dataFim }, ... ]
 *
 * Como NÃO existe API de listagem, a lista da tela é guardada no navegador
 * (localStorage): cada processamento criado aqui entra na lista, e a API de status é
 * consultada em lote para atualizar status e datas. Consequência: cada navegador
 * enxerga apenas o que foi criado nele.
 */
import { STATUS_FINAIS } from './constantes.js';
import { ApiError } from './api-erro.js';
import { consultar, visao } from './lista-local.js';
import { validarProcessamento } from './validators.js';

export const CHAVE_ARMAZEM = 'big-glass:processamentos-http:v1';
const LOTE_STATUS = 50; // ids por chamada à API de status (evita URL longa demais)

export const MSG_AUTH = 'Autenticação falhou. Verifique se o token de acesso é válido e não expirou.';
const MSG_SEM_RESPOSTA = 'A API de processamento não respondeu. Reenvie quando ela voltar.';
const MSG_ERRO_API = 'A API de processamento retornou erro (HTTP 500). Reenvie quando ela voltar.';
const MSG_AINDA_FORA = 'A API de processamento continua com problema. Tente novamente em instantes.';
const MSG_STATUS_FORA = 'Não foi possível consultar o status agora. Exibindo os últimos dados salvos.';

// ---------- status ----------

/** codStatus (número) -> chave interna. Preencha quando os códigos da API forem conhecidos. */
export const CODIGOS_STATUS = {};

// Status por texto (sem acento, maiúsculo). Textos fora desta lista aparecem como vieram da API.
const POR_TEXTO = {
  'NA FILA': 'NA_FILA',
  RECEBIDO: 'RECEBIDO',
  PROCESSANDO: 'PROCESSANDO',
  CONCLUIDO: 'CONCLUIDO',
  'CONCLUIDO COM ALERTAS': 'CONCLUIDO_COM_ALERTAS',
  ERRO: 'ERRO',
  CANCELADO: 'CANCELADO',
};

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
    .trim().toUpperCase();
}

export function mapearStatus(codStatus, texto) {
  const porCodigo = Object.hasOwn(CODIGOS_STATUS, codStatus) ? CODIGOS_STATUS[codStatus] : null;
  const norm = normalizar(texto);
  const porTexto = Object.hasOwn(POR_TEXTO, norm) ? POR_TEXTO[norm] : null;
  return { status: porCodigo || porTexto || 'OUTRO', statusRotulo: texto == null ? '' : String(texto) };
}

// ---------- formatos da API ----------

/** "20261028_1000" -> "2026-10-28T10:00:00-03:00" (assume horário de Brasília). null se inválido. */
export function parseDataApi(valor) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(String(valor ?? '').trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** [{numero, ...}] -> "52998224725|1,11222333000181|0" (1 = CPF, 0 = CNPJ). */
export function montarListaDocumento(docs) {
  return docs.map((d) => `${d.numero}|${d.numero.length === 11 ? 1 : 0}`).join(',');
}

function extrairLista(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const interna = Object.values(json).find(Array.isArray);
    if (interna) return interna;
  }
  return [];
}

const ehAuth = (status) => status === 409 || status === 401 || status === 403;

function armazemEmMemoria() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function armazemPadrao() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch (e) { /* acesso bloqueado */ }
  return armazemEmMemoria();
}

/**
 * cfg  = { urlCriar, urlStatus, token | obterToken(), clienteSolicitante, siglaOrgao, usuario }
 * deps = { fetch, storage, agora, origem }  (injetáveis para teste)
 */
export function criarCliente(cfg, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch.bind(globalThis);
  const storage = deps.storage || armazemPadrao();
  const agora = deps.agora || (() => new Date());
  const origem = deps.origem || (globalThis.location ? globalThis.location.origin : 'http://localhost');
  const obterToken = cfg.obterToken || (() => cfg.token || '');

  // ---------- armazenamento local ----------

  let itens = [];

  function ler() {
    try {
      const bruto = storage.getItem(CHAVE_ARMAZEM);
      if (bruto) {
        const lista = JSON.parse(bruto);
        if (Array.isArray(lista)) return lista;
      }
    } catch (e) { /* conteúdo inválido: recomeça vazio */ }
    return [];
  }

  function salvar() {
    try { storage.setItem(CHAVE_ARMAZEM, JSON.stringify(itens)); } catch (e) { /* segue em memória */ }
  }

  const recarregar = () => { itens = ler(); };
  const proximoId = () => Math.max(0, ...itens.map((i) => i.id)) + 1;

  // ---------- HTTP ----------

  /** GET na API. Devolve { status, json }; só lança ApiError(0) quando não há resposta. */
  async function get(urlBase, params) {
    const url = new URL(urlBase, origem);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const headers = { Accept: 'application/json' };
    const token = obterToken();
    if (token) headers.Authentication = `Bearer ${token}`;

    let resp;
    try {
      resp = await fetchImpl(url, { method: 'GET', headers, credentials: 'omit' });
    } catch (e) {
      throw new ApiError(0, { erro: MSG_SEM_RESPOSTA });
    }
    let json = null;
    try { json = await resp.json(); } catch (e) { /* corpo vazio ou não-JSON */ }
    return { status: resp.status, json };
  }

  // ---------- envio ----------

  function marcarFalha(item, codigo, mensagem) {
    item.status = 'FALHA_ENVIO';
    item.statusRotulo = '';
    item.idTrovale = null;
    item.codStatus = null;
    item.inicio = null;
    item.fim = null;
    item.problemas = [{ codigo, severidade: 'ERRO', documento: '', mensagem }];
    return false;
  }

  /** Envia (ou reenvia) o processamento. true = aceito; false = falhou (item marcado). Lança ApiError em falha de autenticação. */
  async function enviar(item) {
    let resp;
    try {
      resp = await get(cfg.urlCriar, {
        nomeProcessamento: item.nome,
        descricao: item.descricao,
        listaDocumento: montarListaDocumento(item.docs),
        clienteSolicitante: cfg.clienteSolicitante,
        siglaOrgaoSolicitante: cfg.siglaOrgao,
      });
    } catch (e) {
      return marcarFalha(item, 'ENVIO_SEM_RESPOSTA', MSG_SEM_RESPOSTA);
    }

    if (ehAuth(resp.status)) throw new ApiError(resp.status, { erro: MSG_AUTH });
    if (resp.status < 200 || resp.status >= 300) {
      return marcarFalha(item, 'ENVIO_ERRO_API', MSG_ERRO_API);
    }

    const id = Number(resp.json && resp.json.idProcessamento);
    if (!Number.isInteger(id) || id <= 0) {
      return marcarFalha(item, 'ENVIO_RESPOSTA_INVALIDA', 'A API respondeu sem o idProcessamento. Reenvie quando ela voltar.');
    }
    const { status, statusRotulo } = mapearStatus(resp.json.codStatus, resp.json.status);
    item.idTrovale = id;
    item.status = status;
    item.statusRotulo = statusRotulo;
    item.codStatus = resp.json.codStatus ?? null;
    item.cadastro = parseDataApi(resp.json.dataCadastro) || item.cadastro;
    item.inicio = null;
    item.fim = null;
    item.problemas = [];
    return true;
  }

  // ---------- sincronização com a API de status ----------

  function problemasDoStatus(status) {
    if (status === 'ERRO') {
      return [{
        codigo: 'ERRO_PROCESSAMENTO', severidade: 'ERRO', documento: '',
        mensagem: 'A API informou o status ERRO. A API de status não retorna mais detalhes.',
      }];
    }
    if (status === 'CONCLUIDO_COM_ALERTAS') {
      return [{
        codigo: 'CONCLUIDO_COM_ALERTAS', severidade: 'ALERTA', documento: '',
        mensagem: 'A API informou conclusão com alertas. A API de status não retorna mais detalhes.',
      }];
    }
    return [];
  }

  function aplicar(lote, json) {
    for (const r of extrairLista(json)) {
      const item = lote.find((x) => x.idTrovale === Number(r.idProcessamento));
      if (!item) continue;
      const { status, statusRotulo } = mapearStatus(r.codStatus, r.status);
      item.status = status;
      item.statusRotulo = statusRotulo;
      item.codStatus = r.codStatus ?? null;
      item.cadastro = parseDataApi(r.dataCadastro) || item.cadastro;
      item.inicio = parseDataApi(r.dataInicioProcessamento);
      item.fim = parseDataApi(r.dataFim);
      item.problemas = problemasDoStatus(status);
    }
  }

  /** Atualiza os itens ainda não finalizados. Devolve { ok, aviso }. */
  async function sincronizar(alvos) {
    const pendentes = alvos.filter((i) => i.idTrovale && !STATUS_FINAIS.includes(i.status));
    let ok = true;
    let aviso = '';
    for (let i = 0; i < pendentes.length; i += LOTE_STATUS) {
      const lote = pendentes.slice(i, i + LOTE_STATUS);
      try {
        const resp = await get(cfg.urlStatus, { listaIdProcessamento: lote.map((x) => x.idTrovale).join(',') });
        if (resp.status >= 200 && resp.status < 300) {
          aplicar(lote, resp.json);
        } else {
          ok = false;
          aviso = ehAuth(resp.status) ? MSG_AUTH : MSG_STATUS_FORA;
        }
      } catch (e) {
        ok = false;
        aviso = MSG_STATUS_FORA;
      }
    }
    if (pendentes.length) salvar();
    return { ok, aviso };
  }

  // ---------- operações usadas pela tela ----------

  return {
    async listar(params = {}) {
      recarregar();
      const { ok, aviso } = await sincronizar(itens);
      const resultado = consultar(itens, params, visao);
      if (!ok) {
        resultado.sincronizado = false;
        resultado.aviso = aviso;
      }
      return resultado;
    },

    async obter(id) {
      recarregar();
      const item = itens.find((i) => i.id === Number(id));
      if (!item) throw new ApiError(404, { erro: 'Processamento não encontrado.' });
      await sincronizar([item]);
      return visao(item);
    },

    async criar(payload) {
      const { dados, erros } = validarProcessamento(payload);
      if (Object.keys(erros).length) throw new ApiError(422, { erros });

      recarregar();
      const item = {
        id: proximoId(),
        idTrovale: null,
        nome: dados.nome,
        descricao: dados.descricao,
        usuario: cfg.usuario,
        siglaOrgao: cfg.siglaOrgao,
        espaco: null,
        status: 'PENDENTE_ENVIO',
        statusRotulo: '',
        codStatus: null,
        cadastro: agora().toISOString(),
        inicio: null,
        fim: null,
        docs: dados.docs,
        problemas: [],
      };
      await enviar(item); // falha de autenticação lança aqui e nada é salvo
      itens.push(item);
      salvar();
      return visao(item);
    },

    async reenviar(id) {
      recarregar();
      const item = itens.find((i) => i.id === Number(id));
      if (!item) throw new ApiError(404, { erro: 'Processamento não encontrado.' });
      if (item.status !== 'FALHA_ENVIO') {
        throw new ApiError(409, { erro: 'Só é possível reenviar processamentos com falha no envio.' });
      }
      const aceito = await enviar(item);
      salvar();
      if (!aceito) throw new ApiError(502, { erro: MSG_AINDA_FORA });
      return visao(item);
    },
  };
}
