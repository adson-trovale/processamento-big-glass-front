/**
 * Filtro, busca e paginação sobre uma lista de registros em memória.
 * Usado pela API simulada e pelo adaptador HTTP (a API real não tem endpoint de listagem).
 */
import { GRUPOS } from './constantes.js';

const copia = (x) => JSON.parse(JSON.stringify(x));

/** Versão "pública" de um registro: sem campos internos da simulação. */
export function visao(item) {
  const { sim, enviadoEm, idempotencyKey, ...publico } = copia(item);
  return { ...publico, qtdDocs: item.docs.length };
}

export function consultar(
  itens,
  { filtro = 'todos', usuario = 'todos', q = '', pagina = 1, porPagina = 10 } = {},
  paraVisao = visao,
) {
  const chaveFiltro = Object.hasOwn(GRUPOS, filtro) ? filtro : 'todos';
  const termo = String(q).trim().toLocaleLowerCase('pt-BR');

  const contagem = {};
  for (const [chave, grupo] of Object.entries(GRUPOS)) {
    contagem[chave] = grupo.status ? itens.filter((i) => grupo.status.includes(i.status)).length : itens.length;
  }
  const usuarios = [...new Set(itens.map((i) => i.usuario))].sort();

  const status = GRUPOS[chaveFiltro].status;
  const filtrados = itens
    .filter((i) => !status || status.includes(i.status))
    .filter((i) => usuario === 'todos' || i.usuario === usuario)
    .filter((i) => !termo
      || i.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || String(i.idTrovale ?? '').includes(termo))
    .sort((a, b) => Date.parse(b.cadastro) - Date.parse(a.cadastro) || b.id - a.id);

  const total = filtrados.length;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaAjustada = Math.min(Math.max(1, Number(pagina) || 1), totalPaginas);
  const inicio = (paginaAjustada - 1) * porPagina;

  return {
    itens: filtrados.slice(inicio, inicio + porPagina).map(paraVisao),
    total,
    pagina: paginaAjustada,
    totalPaginas,
    contagem,
    usuarios,
  };
}
