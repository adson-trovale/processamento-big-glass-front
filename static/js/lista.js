import { GRUPOS, STATUS_COM_ALERTA, infoStatus } from './constantes.js';
import { fmtDataHora, janelaPaginas } from './format.js';
import { $, clonar, el, preencher } from './dom.js';

/** Cards de resumo. Cria uma vez e depois só atualiza, para não perder o foco do teclado. */
export function pintarStats(contagem, filtroAtivo) {
  const caixa = $('#stats');
  const grupos = Object.entries(GRUPOS);
  if (caixa.children.length !== grupos.length) {
    caixa.textContent = '';
    for (const [chave, grupo] of grupos) {
      const botao = clonar('tpl-stat');
      botao.dataset.filtro = chave;
      $('.dot', botao).classList.add(`dot-${chave}`);
      preencher(botao, { rotulo: grupo.rotulo });
      caixa.appendChild(botao);
    }
  }
  for (const botao of caixa.children) {
    const ativo = botao.dataset.filtro === filtroAtivo;
    botao.classList.toggle('on', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
    preencher(botao, { valor: contagem[botao.dataset.filtro] ?? 0 });
  }
}

export function pintarLinhas(itens) {
  const corpo = $('#linhas');
  const focado = document.activeElement && document.activeElement.closest
    ? document.activeElement.closest('[data-ver]') : null;
  const idFocado = focado ? focado.dataset.id : null;

  corpo.textContent = '';
  for (const item of itens) {
    const [rotulo, cor] = infoStatus(item);
    const tr = clonar('tpl-linha');
    preencher(tr, {
      id: item.idTrovale ?? '—',
      nome: item.nome,
      descricao: item.descricao || '—',
      usuario: item.usuario,
      qtd: item.qtdDocs ?? (item.docs ? item.docs.length : 0),
      status: rotulo,
      cadastro: fmtDataHora(item.cadastro),
      inicio: fmtDataHora(item.inicio),
      fim: fmtDataHora(item.fim),
    });
    const badge = $('[data-campo="badge"]', tr);
    badge.classList.add(`b-${cor}`);
    // SVG não tem a propriedade .hidden: é preciso usar o atributo.
    $('svg', badge).toggleAttribute('hidden', !STATUS_COM_ALERTA.includes(item.status));
    $('[data-ver]', tr).dataset.id = item.id;
    corpo.appendChild(tr);
  }

  if (idFocado) {
    const novo = $(`[data-ver][data-id="${CSS.escape(idFocado)}"]`, corpo);
    if (novo) novo.focus();
  }
}

/** Mensagem no lugar da tabela (carregando, vazio ou erro). texto vazio esconde. */
export function pintarEstado(texto, { acaoRotulo, aoClicar } = {}) {
  const caixa = $('#lista-estado');
  caixa.textContent = '';
  caixa.hidden = !texto;
  if (!texto) return;
  caixa.appendChild(el('span', null, texto));
  if (acaoRotulo) {
    const b = el('button', 'btn btn-outline estado-acao', acaoRotulo);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    caixa.appendChild(b);
  }
}

export function pintarRodape({ total, pagina, totalPaginas, porPagina, qtdNaPagina }) {
  const primeiro = total ? (pagina - 1) * porPagina + 1 : 0;
  $('#rodape-texto').textContent = total
    ? `Mostrando ${primeiro}–${primeiro + qtdNaPagina - 1} de ${total} processamentos`
    : 'Nenhum resultado';

  const nav = $('#paginacao');
  nav.textContent = '';
  const botao = (texto, alvo, { desativado = false, atual = false, classe = 'btn-pag' } = {}) => {
    const b = el('button', `btn ${atual ? 'btn-primary' : 'btn-outline'} ${classe}`, texto);
    b.type = 'button';
    if (atual) b.setAttribute('aria-current', 'page');
    if (desativado) b.disabled = true;
    else if (!atual) b.dataset.pagina = alvo;
    return b;
  };

  nav.appendChild(botao('Anterior', pagina - 1, { desativado: pagina <= 1 }));
  for (const p of janelaPaginas(pagina, totalPaginas)) {
    if (p === null) {
      const gap = el('span', 'pag-gap', '…');
      gap.setAttribute('aria-hidden', 'true');
      nav.appendChild(gap);
    } else {
      nav.appendChild(botao(String(p), p, { atual: p === pagina, classe: 'btn-num' }));
    }
  }
  nav.appendChild(botao('Próxima', pagina + 1, { desativado: pagina >= totalPaginas }));
}
