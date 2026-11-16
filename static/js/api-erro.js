/**
 * Erro lançado pela camada de API (mock ou HTTP).
 *  - status: código HTTP (0 = sem resposta / rede)
 *  - erros:  { campo: mensagem } quando o servidor devolve validação (422)
 */
export class ApiError extends Error {
  constructor(status, corpo = {}) {
    super(corpo.erro || `Erro ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.erros = corpo.erros || null;
  }
}
