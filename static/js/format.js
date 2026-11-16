const FORMATADOR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

let comSegundos = true;

/** A API real só informa até o minuto; nesse caso a tela não mostra segundos. */
export function definirPrecisao(mostrarSegundos) {
  comSegundos = !!mostrarSegundos;
}

/** '2026-10-27T14:02:10-03:00' -> '27/10/2026 14:02:10' (horário de Brasília). */
export function fmtDataHora(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  const p = {};
  for (const parte of FORMATADOR.formatToParts(data)) p[parte.type] = parte.value;
  const base = `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  return comSegundos ? `${base}:${p.second}` : base;
}

/** Referência externa enviada à API (ex.: PARC-000132). */
export function referencia(id) {
  return `PARC-${String(id).padStart(6, '0')}`;
}

/** Números de página a exibir; null representa reticências. */
export function janelaPaginas(atual, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const paginas = [...new Set([1, total, atual - 1, atual, atual + 1])]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const resultado = [];
  let anterior = 0;
  for (const p of paginas) {
    if (p - anterior > 1) resultado.push(null);
    resultado.push(p);
    anterior = p;
  }
  return resultado;
}
