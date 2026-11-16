import { ESPACOS, infoStatus } from './constantes.js';
import { fmtDataHora } from './format.js';
import { fmtDoc, tipoDoc } from './validators.js';
import { $, clonar, el, mostrar, preencher } from './dom.js';
import { reabrirToasts, toast } from './toast.js';

/** Mostra o campo só se houver valor (a API real não informa todos os campos do protótipo). */
function campo(caixa, destino, valor) {
  caixa.hidden = !valor;
  destino.textContent = valor || '';
}

/**
 * Diálogo de detalhes de um processamento.
 * aoReenviar(processamento) é chamado depois de um reenvio aceito.
 */
export function iniciarDetalhe({ api, aoReenviar }) {
  const dlg = $('#dlg-detalhe');
  const btnReenviar = $('#btn-reenviar');
  let atual = null;

  // Clique no fundo escurecido fecha os detalhes.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  function pintar(p) {
    atual = p;
    const [rotulo, cor] = infoStatus(p);

    $('#det-id').textContent = `Processamento ${p.idTrovale ?? '(sem ID Trovale)'}`;
    $('#det-titulo').textContent = p.nome;
    const badge = $('#det-badge');
    badge.className = `badge det-badge b-${cor}`;
    badge.textContent = rotulo;

    $('#det-usuario').textContent = p.usuario;
    campo($('#det-c-espaco'), $('#det-espaco'), ESPACOS[p.espaco] || p.espaco);
    $('#det-cadastro').textContent = fmtDataHora(p.cadastro);
    $('#det-inicio').textContent = fmtDataHora(p.inicio);
    $('#det-fim').textContent = fmtDataHora(p.fim);
    campo($('#det-c-orgao'), $('#det-orgao'), p.siglaOrgao);
    campo($('#det-c-ref'), $('#det-ref'), p.referencia);
    $('#det-desc').textContent = p.descricao || '—';

    const docs = p.docs || [];
    $('#det-qtd').textContent = String(docs.length);
    const caixaDocs = $('#det-docs');
    caixaDocs.textContent = '';
    for (const d of docs) {
      caixaDocs.appendChild(el('span', `badge ${d.numero.length === 11 ? 'b-navy' : 'b-gray'}`,
        `${tipoDoc(d.numero)} · ${fmtDoc(d.numero)}`));
    }

    const problemas = p.problemas || [];
    $('#det-sem-problemas').hidden = problemas.length > 0;
    const caixaProblemas = $('#det-problemas');
    caixaProblemas.textContent = '';
    for (const pr of problemas) {
      const box = clonar('tpl-problema');
      box.classList.add(pr.severidade === 'ERRO' ? 'prob-erro' : 'prob-alerta');
      preencher(box, {
        codigo: pr.codigo,
        severidade: pr.severidade,
        documento: pr.documento ? `· ${fmtDoc(pr.documento)}` : '',
        mensagem: pr.mensagem,
      });
      caixaProblemas.appendChild(box);
    }

    mostrar($('#det-erro'), '');
    btnReenviar.hidden = p.status !== 'FALHA_ENVIO';
    btnReenviar.disabled = false;
  }

  btnReenviar.addEventListener('click', async () => {
    if (!atual) return;
    mostrar($('#det-erro'), '');
    btnReenviar.disabled = true;
    try {
      const p = await api.reenviar(atual.id);
      dlg.close();
      await aoReenviar(p);
    } catch (e) {
      btnReenviar.disabled = false;
      mostrar($('#det-erro'), e.message || 'Não foi possível reenviar o processamento.');
    }
  });

  return {
    async abrir(id) {
      try {
        pintar(await api.obter(id));
      } catch (e) {
        toast(e.message || 'Não foi possível carregar os detalhes.', 'erro');
        return;
      }
      dlg.showModal();
      reabrirToasts(); // mantém os avisos acima do diálogo
    },
  };
}
