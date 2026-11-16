const SVG_NS = 'http://www.w3.org/2000/svg';

export function $(sel, raiz = document) {
  return raiz.querySelector(sel);
}

export function el(tag, cls, texto) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
}

/** Ícone do sprite definido em _icones.html. */
export function icone(nome, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${nome}`);
  svg.appendChild(use);
  return svg;
}

/** Mostra a mensagem no elemento, ou o esconde se vier vazia. */
export function mostrar(elemento, texto) {
  if (!elemento) return;
  if (texto) {
    elemento.textContent = texto;
    elemento.hidden = false;
  } else {
    elemento.textContent = '';
    elemento.hidden = true;
  }
}

/** Clona o primeiro elemento de um <template>. */
export function clonar(idTemplate) {
  return document.getElementById(idTemplate).content.firstElementChild.cloneNode(true);
}

/** Preenche (via textContent) os elementos [data-campo="x"] de uma raiz. */
export function preencher(raiz, valores) {
  for (const [campo, valor] of Object.entries(valores)) {
    const alvo = $(`[data-campo="${campo}"]`, raiz);
    if (alvo) alvo.textContent = valor == null ? '' : String(valor);
  }
}
