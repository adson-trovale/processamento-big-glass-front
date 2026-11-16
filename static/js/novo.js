import { LIMITE_DOCS } from './constantes.js';
import { fmtDoc, soDigitos, validarDoc } from './validators.js';
import { $, el, icone, mostrar } from './dom.js';
import { ApiError } from './api-erro.js';
import { reabrirToasts } from './toast.js';

const EXEMPLO = 'documento;tipo\n11.222.333/0001-81;0\n529.982.247-25;1\n12345678000195;0\n111.444.777-00;1\n39053344705';
const TAMANHO_MAXIMO_ARQUIVO = 51200; // 50 KB

/**
 * Diálogo "Novo processamento".
 * aoCriar(processamento) é chamado depois que a API aceita o pedido.
 */
export function iniciarNovo({ api, aoCriar }) {
  const dlg = $('#dlg-novo');
  const inpNome = $('#nome');
  const inpDesc = $('#descricao');
  const inpDoc = $('#doc');
  const btnSolicitar = $('#btn-solicitar');
  const btnAdicionar = $('#btn-adicionar');
  const navHist = $('#nav-hist');
  const navNovo = $('#nav-novo');

  let docs = []; // [{ numero, origem }]

  // ---------- documentos ----------

  function erroDoc(msg) {
    mostrar($('#doc-erro'), msg);
    inpDoc.classList.toggle('err', !!msg);
  }

  function atualizarBotao() {
    btnSolicitar.disabled = !inpNome.value.trim() || docs.length === 0;
  }

  function renderDocs() {
    const n = docs.length;
    const contador = $('#qtd-docs');
    contador.textContent = `${n} de ${LIMITE_DOCS}`;
    contador.className = `badge contador ${n >= LIMITE_DOCS ? 'b-red' : (n >= LIMITE_DOCS - 2 ? 'b-orange' : 'b-gray')}`;

    const pf = docs.filter((d) => d.numero.length === 11).length;
    $('#resumo-docs').textContent = n ? `${n} (${n - pf} PJ, ${pf} PF)` : 'Nenhum';

    $('#docs-vazio').hidden = n > 0;
    $('#docs-tabela').hidden = n === 0;
    inpDoc.disabled = n >= LIMITE_DOCS;
    btnAdicionar.disabled = n >= LIMITE_DOCS;

    const corpo = $('#docs-corpo');
    corpo.textContent = '';
    for (const d of docs) {
      const tr = el('tr');
      tr.appendChild(el('td', 'doc-num', fmtDoc(d.numero)));

      const tdTipo = el('td');
      tdTipo.appendChild(el('span', `badge ${d.numero.length === 11 ? 'b-navy' : 'b-gray'}`,
        d.numero.length === 11 ? 'PF' : 'PJ'));
      tr.appendChild(tdTipo);

      tr.appendChild(el('td', 'doc-origem', d.origem));

      const tdAcao = el('td', 'dir');
      const rm = el('button', 'btn btn-ghost del');
      rm.type = 'button';
      rm.title = 'Remover';
      rm.setAttribute('aria-label', 'Remover documento');
      rm.appendChild(icone('trash'));
      rm.addEventListener('click', () => {
        docs = docs.filter((x) => x.numero !== d.numero);
        erroDoc('');
        mostrar($('#docs-erro'), '');
        renderDocs();
      });
      tdAcao.appendChild(rm);
      tr.appendChild(tdAcao);
      corpo.appendChild(tr);
    }
    atualizarBotao();
  }

  function adicionarDoc() {
    const d = soDigitos(inpDoc.value);
    if (!d) return erroDoc('Digite um CPF ou CNPJ.');
    const erro = validarDoc(d);
    if (erro) return erroDoc(erro);
    if (docs.some((x) => x.numero === d)) return erroDoc('Este documento já está na lista.');
    if (docs.length >= LIMITE_DOCS) return erroDoc(`Limite de ${LIMITE_DOCS} documentos atingido.`);
    docs.push({ numero: d, origem: 'Manual' });
    inpDoc.value = '';
    erroDoc('');
    mostrar($('#docs-erro'), '');
    renderDocs();
    inpDoc.focus();
    return undefined;
  }

  function processarTexto(texto) {
    const linhas = String(texto || '').split(/\r?\n/);
    const validos = [];
    const ignoradas = [];
    linhas.forEach((bruta, i) => {
      const linha = bruta.trim();
      if (!linha) return;
      const cols = linha.split(/[;,\t]/);
      const d = soDigitos(cols[0]);
      if (!d && i === 0) return; // cabeçalho
      let erro = validarDoc(d);
      const tipoCol = cols.length > 1 ? cols[1].trim() : '';
      if (!erro && tipoCol === '1' && d.length !== 11) erro = 'Tipo 1 (PF) mas o número não é um CPF.';
      if (!erro && tipoCol === '0' && d.length !== 14) erro = 'Tipo 0 (PJ) mas o número não é um CNPJ.';
      if (erro) { ignoradas.push(`Linha ${i + 1} (${cols[0].trim()}): ${erro}`); return; }
      const jaNaLista = docs.some((x) => x.numero === d);
      if (!validos.includes(d) && !jaNaLista) validos.push(d);
    });

    const lista = $('#ignoradas-lista');
    lista.textContent = '';
    for (const t of ignoradas) lista.appendChild(el('span', null, t));
    $('#ignoradas').hidden = ignoradas.length === 0;

    const total = docs.length + validos.length;
    if (total > LIMITE_DOCS) {
      mostrar($('#import-ok'), '');
      mostrar($('#import-erro'),
        `O arquivo tem ${validos.length} documentos válidos e a lista ficaria com ${total}. O limite é ${LIMITE_DOCS}: nada foi importado.`);
      return;
    }
    if (!validos.length) {
      mostrar($('#import-ok'), '');
      mostrar($('#import-erro'), 'Nenhum documento válido novo encontrado no arquivo.');
      return;
    }
    for (const d of validos) docs.push({ numero: d, origem: 'Arquivo' });
    mostrar($('#import-erro'), '');
    mostrar($('#docs-erro'), '');
    const sufixo = ignoradas.length
      ? ` · ${ignoradas.length} ${ignoradas.length === 1 ? 'linha ignorada' : 'linhas ignoradas'}` : '';
    mostrar($('#import-ok'),
      `${validos.length} ${validos.length === 1 ? 'documento importado' : 'documentos importados'}${sufixo}.`);
    renderDocs();
  }

  function definirModo(digitar) {
    $('#painel-digitar').hidden = !digitar;
    $('#painel-arquivo').hidden = digitar;
    $('#seg-digitar').classList.toggle('on', digitar);
    $('#seg-arquivo').classList.toggle('on', !digitar);
    $('#seg-digitar').setAttribute('aria-pressed', String(digitar));
    $('#seg-arquivo').setAttribute('aria-pressed', String(!digitar));
  }

  $('#seg-digitar').addEventListener('click', () => definirModo(true));
  $('#seg-arquivo').addEventListener('click', () => definirModo(false));

  btnAdicionar.addEventListener('click', adicionarDoc);
  inpDoc.addEventListener('input', () => erroDoc(''));
  inpDoc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarDoc(); }
  });

  $('#btn-exemplo').addEventListener('click', () => {
    const pre = $('#exemplo');
    pre.hidden = !pre.hidden;
    $('#exemplo-rotulo').textContent = pre.hidden ? 'Ver exemplo de arquivo' : 'Ocultar exemplo';
  });
  $('#btn-importar-exemplo').addEventListener('click', () => processarTexto(EXEMPLO));

  $('#arquivo').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > TAMANHO_MAXIMO_ARQUIVO) {
      mostrar($('#import-ok'), '');
      mostrar($('#import-erro'), 'Arquivo maior que 50 KB.');
      $('#ignoradas').hidden = true;
      e.target.value = '';
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => processarTexto(leitor.result);
    leitor.readAsText(f);
    e.target.value = '';
  });

  // ---------- campos de texto ----------

  inpNome.addEventListener('input', () => {
    mostrar($('#nome-erro'), '');
    inpNome.classList.remove('err');
    atualizarBotao();
  });
  inpDesc.addEventListener('input', () => {
    $('#desc-cont').textContent = String(inpDesc.value.length);
    mostrar($('#descricao-erro'), '');
  });

  function mostrarErros(erros) {
    mostrar($('#nome-erro'), erros.nome);
    inpNome.classList.toggle('err', !!erros.nome);
    mostrar($('#descricao-erro'), erros.descricao);
    mostrar($('#docs-erro'), erros.docs);
    mostrar($('#form-erro'), erros.geral);
  }

  function limpar() {
    docs = [];
    inpNome.value = '';
    inpDesc.value = '';
    inpDoc.value = '';
    $('#desc-cont').textContent = '0';
    mostrarErros({});
    erroDoc('');
    mostrar($('#import-ok'), '');
    mostrar($('#import-erro'), '');
    $('#ignoradas').hidden = true;
    definirModo(true);
    renderDocs();
  }

  // ---------- envio ----------

  btnSolicitar.addEventListener('click', async () => {
    mostrarErros({});
    btnSolicitar.disabled = true;
    try {
      const criado = await api.criar({
        nome: inpNome.value.trim(),
        descricao: inpDesc.value.trim(),
        docs,
      });
      dlg.close();
      limpar();
      await aoCriar(criado);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && e.erros) mostrarErros(e.erros);
      else mostrar($('#form-erro'), e.message || 'Não foi possível criar o processamento.');
      atualizarBotao();
    }
  });

  // ---------- abrir/fechar e destaque do menu ----------

  function marcarNav() {
    navNovo.classList.toggle('on', dlg.open);
    navHist.classList.toggle('on', !dlg.open);
    if (dlg.open) navHist.removeAttribute('aria-current');
    else navHist.setAttribute('aria-current', 'page');
  }
  dlg.addEventListener('close', marcarNav);

  renderDocs();

  return {
    abrir() {
      if (dlg.open) return;
      dlg.showModal();
      reabrirToasts(); // mantém os avisos acima do diálogo
      marcarNav();
      inpNome.focus();
    },
  };
}
