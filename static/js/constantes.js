export const LIMITE_DOCS = 10;
export const LIMITE_NOME = 120;
export const LIMITE_DESCRICAO = 500;
export const POR_PAGINA = 10;
export const INTERVALO_ATUALIZACAO_MS = 60000;

export const ORIGENS = ['Manual', 'Arquivo'];

// status -> [rótulo exibido, cor do badge]
export const STATUS = {
  PENDENTE_ENVIO: ['Enviando', 'gray'],
  FALHA_ENVIO: ['Falha no envio', 'red'],
  RECEBIDO: ['Recebido', 'blue'],
  NA_FILA: ['Na fila', 'blue'],
  PROCESSANDO: ['Processando', 'orange'],
  CONCLUIDO: ['Concluído', 'green'],
  CONCLUIDO_COM_ALERTAS: ['Concluído com alertas', 'orange'],
  ERRO: ['Erro', 'red'],
  CANCELADO: ['Cancelado', 'gray'],
};

// Status que exibem o ícone de alerta na tabela.
export const STATUS_COM_ALERTA = ['CONCLUIDO_COM_ALERTAS', 'ERRO', 'FALHA_ENVIO'];

// Filtros dos cards de resumo. status === null significa "todos".
export const GRUPOS = {
  todos: { rotulo: 'Todos', status: null },
  fila: { rotulo: 'Na fila', status: ['RECEBIDO', 'NA_FILA', 'PENDENTE_ENVIO'] },
  processando: { rotulo: 'Processando', status: ['PROCESSANDO'] },
  concluidos: { rotulo: 'Concluídos', status: ['CONCLUIDO', 'CONCLUIDO_COM_ALERTAS'] },
  problema: { rotulo: 'Com problema', status: ['CONCLUIDO_COM_ALERTAS', 'ERRO', 'FALHA_ENVIO'] },
};

export const ESPACOS = {
  TROVALE_1510: 'TROVALE 1510',
  TROVALE_1620: 'TROVALE 1620',
  TROVALE_TREINAMENTO: 'TROVALE TREINAMENTO',
};

// Status que não mudam mais: não precisam ser consultados de novo na API de status.
export const STATUS_FINAIS = ['CONCLUIDO', 'CONCLUIDO_COM_ALERTAS', 'ERRO', 'CANCELADO'];

/** [rótulo, cor] de um processamento. Status que a tela não conhece mostram o texto da API em cinza. */
export function infoStatus(item) {
  return STATUS[item.status] || [item.statusRotulo || item.status, 'gray'];
}
