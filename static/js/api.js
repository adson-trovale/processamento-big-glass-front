import { criarCliente as criarMock } from './api-mock.js';
import { criarCliente as criarHttp } from './api-http.js';

/**
 * Devolve o cliente de API com as mesmas quatro operações nos dois modos:
 * listar(params), obter(id), criar(dados), reenviar(id).
 * `http` = { urlCriar, urlStatus, token, clienteSolicitante, siglaOrgao }
 */
export function criarApi({ modo, usuario, http }) {
  if (modo === 'http') return criarHttp({ ...http, usuario });
  return criarMock(undefined, usuario);
}
