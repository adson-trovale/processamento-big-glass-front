import { $, el, icone } from './dom.js';

const DURACAO_MS = 4000;

function abrir() {
  // O popover fica na "camada superior", acima de diálogos modais abertos.
  const caixa = $('#toasts');
  try {
    if (caixa.hidePopover) caixa.hidePopover();
    if (caixa.showPopover) caixa.showPopover();
  } catch (e) { /* navegador sem suporte: o CSS já posiciona a caixa */ }
}

function remover(t) {
  const caixa = $('#toasts');
  if (t.parentNode) t.parentNode.removeChild(t);
  if (!caixa.children.length) {
    try { if (caixa.hidePopover) caixa.hidePopover(); } catch (e) { /* ok */ }
  }
}

/** Reabre a caixa de avisos (use depois de abrir um diálogo, para ela ficar por cima). */
export function reabrirToasts() {
  if ($('#toasts').children.length) abrir();
}

export function toast(texto, tipo = 'sucesso') {
  const erro = tipo === 'erro';
  const t = el('div', `toast toast-${erro ? 'erro' : 'sucesso'}`);
  t.appendChild(icone(erro ? 'alert' : 'check-circle'));
  t.appendChild(el('span', null, texto));
  $('#toasts').appendChild(t);
  abrir();
  setTimeout(() => remover(t), DURACAO_MS);
}
