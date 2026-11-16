import { LIMITE_DESCRICAO, LIMITE_DOCS, LIMITE_NOME, ORIGENS } from './constantes.js';

export function soDigitos(s) {
  return String(s == null ? '' : s).replace(/[^0-9]/g, '');
}

export function cpfValido(d) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (let i = 9; i < 11; i++) {
    let s = 0;
    for (let j = 0; j < i; j++) s += Number(d.charAt(j)) * (i + 1 - j);
    if ((s * 10) % 11 % 10 !== Number(d.charAt(i))) return false;
  }
  return true;
}

const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_2 = [6, ...PESOS_CNPJ_1];

export function cnpjValido(d) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  for (const [n, pesos] of [[12, PESOS_CNPJ_1], [13, PESOS_CNPJ_2]]) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Number(d.charAt(j)) * pesos[j];
    const r = s % 11;
    const dv = r < 2 ? 0 : 11 - r;
    if (dv !== Number(d.charAt(n))) return false;
  }
  return true;
}

/** Retorna null se o documento (só dígitos) é válido, senão a mensagem de erro. */
export function validarDoc(d) {
  if (d.length === 11) return cpfValido(d) ? null : 'CPF inválido (dígito verificador não confere).';
  if (d.length === 14) return cnpjValido(d) ? null : 'CNPJ inválido (dígito verificador não confere).';
  return 'Informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).';
}

export function fmtDoc(d) {
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

export function tipoDoc(d) {
  return d.length === 11 ? 'PF' : 'PJ';
}

/**
 * Valida o corpo de criação ({ nome, descricao, docs: [{ numero, origem }] }).
 * Retorna { dados, erros }; havendo erros, dados é null.
 */
export function validarProcessamento(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { dados: null, erros: { geral: 'Requisição inválida.' } };
  }
  const erros = {};

  const nome = typeof payload.nome === 'string' ? payload.nome.trim() : '';
  if (!nome) erros.nome = 'Informe o nome do processamento.';
  else if (nome.length > LIMITE_NOME) erros.nome = `O nome deve ter no máximo ${LIMITE_NOME} caracteres.`;

  const descricao = typeof payload.descricao === 'string' ? payload.descricao.trim() : '';
  if (descricao.length > LIMITE_DESCRICAO) {
    erros.descricao = `A descrição deve ter no máximo ${LIMITE_DESCRICAO} caracteres.`;
  }

  const docs = [];
  const brutos = payload.docs;
  if (!Array.isArray(brutos) || brutos.length === 0) {
    erros.docs = 'Adicione ao menos um documento.';
  } else if (brutos.length > LIMITE_DOCS) {
    erros.docs = `Limite de ${LIMITE_DOCS} documentos excedido.`;
  } else {
    const vistos = new Set();
    for (let i = 0; i < brutos.length; i++) {
      const item = brutos[i];
      if (!item || typeof item !== 'object') { erros.docs = 'Lista de documentos inválida.'; break; }
      const numero = soDigitos(item.numero);
      const erro = validarDoc(numero);
      if (erro) { erros.docs = `Documento ${i + 1}: ${erro}`; break; }
      if (vistos.has(numero)) { erros.docs = `Documento ${i + 1} está duplicado na lista.`; break; }
      vistos.add(numero);
      docs.push({ numero, origem: ORIGENS.includes(item.origem) ? item.origem : 'Manual' });
    }
  }

  if (Object.keys(erros).length) return { dados: null, erros };
  return { dados: { nome, descricao, docs }, erros: {} };
}
