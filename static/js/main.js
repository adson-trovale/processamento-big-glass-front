import { GRUPOS, INTERVALO_ATUALIZACAO_MS, LIMITE_NOME, POR_PAGINA } from './constantes.js';
import { criarApi } from './api.js';
import { $ } from './dom.js';
import { definirPrecisao } from './format.js';
import { toast } from './toast.js';
import { pintarEstado, pintarLinhas, pintarRodape, pintarStats } from './lista.js';
import { iniciarDetalhe } from './detalhe.js';
import { iniciarNovo } from './novo.js';

const cfg = document.body.dataset;
const api = criarApi({
  modo: cfg.apiModo,
  usuario: cfg.usuario,
  http: {
    urlCriar: cfg.apiUrlCriar,
    urlStatus: cfg.apiUrlStatus,
    token: cfg.apiToken,
    clienteSolicitante: cfg.clienteSolicitante,
    siglaOrgao: cfg.siglaOrgao,
  },
});
definirPrecisao(cfg.apiModo !== 'http'); // a API real só informa até o minuto

// ---------- estado dos filtros (espelhado na URL, para o F5 e links) ----------

function lerUrl() {
  const p = new URLSearchParams(location.search);
  const filtro = p.get('filtro');
  return {
    filtro: filtro && Object.hasOwn(GRUPOS, filtro) ? filtro : 'todos',
    usuario: p.get('usuario') || 'todos',
    q: (p.get('q') || '').slice(0, LIMITE_NOME),
    pagina: Math.max(1, parseInt(p.get('pagina'), 10) || 1),
  };
}

function gravarUrl() {
  const atual = new URLSearchParams(location.search);
  const p = new URLSearchParams();
  // Opções da API simulada ficam na URL, exceto mock_reset, que vale uma vez só (senão o F5 apagaria tudo).
  for (const [k, v] of atual) if (k.startsWith('mock_') && k !== 'mock_reset') p.set(k, v);
  if (estado.filtro !== 'todos') p.set('filtro', estado.filtro);
  if (estado.usuario !== 'todos') p.set('usuario', estado.usuario);
  if (estado.q) p.set('q', estado.q);
  if (estado.pagina > 1) p.set('pagina', String(estado.pagina));
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
}

const estado = lerUrl();
$('#busca').value = estado.q;

// ---------- carregamento da lista ----------

let sequencia = 0;
let primeiraCarga = true;

function pintarUsuarios(usuarios) {
  const select = $('#filtro-usuario');
  const opcoes = ['todos', ...usuarios];
  if (select.options.length !== opcoes.length || [...select.options].some((o, i) => o.value !== opcoes[i])) {
    select.textContent = '';
    for (const u of opcoes) {
      const o = document.createElement('option');
      o.value = u;
      o.textContent = u === 'todos' ? 'Todos os usuários' : u;
      select.appendChild(o);
    }
  }
  if (!opcoes.includes(estado.usuario)) estado.usuario = 'todos';
  select.value = estado.usuario;
}

/** Busca a lista na API e repinta. Devolve o resultado, ou false se falhou. */
async function carregar({ silencioso = false } = {}) {
  const minha = ++sequencia; // ignora respostas antigas que cheguem fora de ordem
  try {
    const r = await api.listar({ ...estado, porPagina: POR_PAGINA });
    if (minha !== sequencia) return false;

    estado.pagina = r.pagina;
    pintarUsuarios(r.usuarios || []);
    pintarStats(r.contagem, estado.filtro);
    pintarLinhas(r.itens);
    pintarRodape({
      total: r.total, pagina: r.pagina, totalPaginas: r.totalPaginas,
      porPagina: POR_PAGINA, qtdNaPagina: r.itens.length,
    });
    pintarEstado(r.itens.length ? '' : 'Nenhum processamento encontrado com estes filtros.');
    $('#filtro-rotulo').textContent = `Filtro: ${GRUPOS[estado.filtro].rotulo}`;
    gravarUrl();
    primeiraCarga = false;
    return r;
  } catch (e) {
    if (minha !== sequencia) return false;
    // Na atualização automática, mantém o que já está na tela e tenta de novo no próximo ciclo.
    if (!silencioso || primeiraCarga) {
      pintarEstado(e.message || 'Não foi possível carregar os processamentos.', {
        acaoRotulo: 'Tentar novamente',
        aoClicar: () => carregar(),
      });
    }
    return false;
  }
}

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

// ---------- diálogos ----------

const detalhe = iniciarDetalhe({
  api,
  async aoReenviar(p) {
    await carregar();
    toast(`Reenvio aceito. Processamento ${p.idTrovale} na fila.`);
  },
});

const novo = iniciarNovo({
  api,
  async aoCriar(p) {
    // Mostra o novo processamento: volta para "Todos", sem busca e na primeira página.
    Object.assign(estado, { filtro: 'todos', usuario: 'todos', q: '', pagina: 1 });
    $('#busca').value = '';
    await carregar();
    if (p.status === 'FALHA_ENVIO') {
      toast('Processamento registrado, mas o envio ao BIG GLASS falhou. Abra os detalhes e use Reenviar.', 'erro');
    } else {
      toast(`Processamento ${p.idTrovale} criado. Status: Na fila. Acompanhe a evolução nesta tabela.`);
    }
  },
});

// ---------- eventos ----------

document.addEventListener('click', (e) => {
  const alvo = e.target instanceof Element ? e.target : e.target.parentElement;
  if (!alvo) return;

  if (alvo.closest('[data-abrir-novo]')) {
    const dlgDetalhe = $('#dlg-detalhe');
    if (dlgDetalhe.open) dlgDetalhe.close();
    novo.abrir();
    return;
  }

  const fechar = alvo.closest('[data-fechar]');
  if (fechar) {
    const dlg = fechar.closest('dialog');
    if (dlg) dlg.close();
    return;
  }

  const card = alvo.closest('[data-filtro]');
  if (card) {
    estado.filtro = card.dataset.filtro;
    estado.pagina = 1;
    carregar();
    return;
  }

  const pagina = alvo.closest('[data-pagina]');
  if (pagina) {
    estado.pagina = Number(pagina.dataset.pagina);
    carregar();
    return;
  }

  const ver = alvo.closest('[data-ver]');
  if (ver) detalhe.abrir(ver.dataset.id);
});

let timerBusca = null;
const form = $('#form-filtros');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(timerBusca);
  estado.q = $('#busca').value.trim();
  estado.pagina = 1;
  carregar();
});

$('#busca').addEventListener('input', () => {
  clearTimeout(timerBusca);
  timerBusca = setTimeout(() => {
    estado.q = $('#busca').value.trim();
    estado.pagina = 1;
    carregar();
  }, 300);
});

$('#filtro-usuario').addEventListener('change', (e) => {
  estado.usuario = e.target.value;
  estado.pagina = 1;
  carregar();
});

$('#btn-atualizar').addEventListener('click', async () => {
  const r = await carregar();
  if (!r) toast('Não foi possível atualizar agora. Tente novamente.', 'erro');
  else if (r.sincronizado === false) toast(r.aviso || 'Não foi possível consultar o status agora.', 'erro');
  else toast(`Status sincronizados com a API Trovale às ${horaAgora()}.`);
});

setInterval(() => {
  if (!document.hidden) carregar({ silencioso: true });
}, INTERVALO_ATUALIZACAO_MS);

carregar();
