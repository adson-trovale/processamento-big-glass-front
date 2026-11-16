"""Teste de ponta a ponta no navegador (opcional).

    pip install playwright && playwright install chromium
    python tests/e2e_playwright.py [pasta-das-capturas]

Sobe o Flask duas vezes (modo mock e modo http) em portas livres e confere o fluxo
completo. No modo http a API é interceptada pelo próprio Playwright, o que valida o
contrato descrito em static/js/api-http.js.
"""
import json
import os
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright
from werkzeug.serving import make_server

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import create_app  # noqa: E402

CAPTURAS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "e2e-capturas")
os.makedirs(CAPTURAS, exist_ok=True)

MOCK = "mock_fila=2&mock_proc=2&mock_desfecho=alertas&mock_atraso=0&mock_reset=1"


def subir(**config):
    servidor = make_server("127.0.0.1", 0, create_app(config), threaded=True)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return servidor, f"http://127.0.0.1:{servidor.server_port}"


def linhas(pg):
    return pg.locator("#linhas tr")


def texto_rodape(pg):
    return pg.locator("#rodape-texto").inner_text()


def fluxo_mock(pg, base, problemas):
    pg.goto(f"{base}/processamentos?{MOCK}")
    expect(linhas(pg)).to_have_count(8)
    print("lista inicial:", texto_rodape(pg))
    assert texto_rodape(pg) == "Mostrando 1–8 de 8 processamentos"
    assert pg.locator(".stat-valor").all_inner_texts() == ["8", "2", "1", "2", "3"]
    # ícone de alerta só nos status Erro / Falha no envio / Concluído com alertas
    for nome, com_icone in (("Zeta Café", True), ("Teta Construções", True), ("Épsilon", True),
                            ("Delta Reciclagem", False), ("Alfa Transportes", False),
                            ("Gama Química", False), ("Eta Engenharia", False)):
        icone = pg.locator("#linhas tr", has_text=nome).locator(".badge svg")
        assert icone.is_visible() == com_icone, f"ícone de alerta em {nome}: esperado {com_icone}"
    pg.screenshot(path=f"{CAPTURAS}/1_lista.png")

    # --- novo processamento: validações e importação ---
    pg.locator("[data-abrir-novo]").first.click()
    expect(pg.locator("#dlg-novo")).to_be_visible()
    expect(pg.locator("#btn-solicitar")).to_be_disabled()
    pg.fill("#nome", "Teste E2E — Ômega Logística")
    pg.fill("#descricao", "Criado pelo teste de ponta a ponta")
    pg.fill("#doc", "123")
    pg.click("#btn-adicionar")
    assert "11 dígitos" in pg.locator("#doc-erro").inner_text()
    pg.fill("#doc", "529.982.247-25")
    pg.press("#doc", "Enter")
    pg.fill("#doc", "529.982.247-25")
    pg.press("#doc", "Enter")
    assert pg.locator("#doc-erro").inner_text() == "Este documento já está na lista."
    pg.click("#seg-arquivo")
    pg.click("#btn-importar-exemplo")
    assert pg.locator("#import-ok").inner_text() == "3 documentos importados · 1 linha ignorada."
    assert "Linha 5 (111.444.777-00)" in pg.locator("#ignoradas-lista").inner_text()
    pg.click("#btn-exemplo")
    assert pg.locator("#resumo-docs").inner_text() == "4 (2 PJ, 2 PF)"
    assert pg.locator("#qtd-docs").inner_text() == "4 de 10"
    pg.screenshot(path=f"{CAPTURAS}/2_modal.png")

    # --- criar ---
    pg.click("#btn-solicitar")
    expect(pg.locator("#dlg-novo")).to_be_hidden()
    expect(pg.locator(".toast")).to_contain_text("Processamento 24862 criado")
    expect(linhas(pg)).to_have_count(9)
    primeira = linhas(pg).first
    assert "24862" in primeira.inner_text() and "Na fila" in primeira.inner_text()
    pg.screenshot(path=f"{CAPTURAS}/3_apos_criar.png")

    # --- o status anda sozinho na API simulada ---
    time.sleep(5)
    pg.click("#btn-atualizar")
    expect(pg.locator(".toast").last).to_contain_text("Status sincronizados")
    expect(linhas(pg).first).to_contain_text("Concluído com alertas")

    # --- filtro por card, busca e persistência na URL ---
    pg.get_by_role("button", name="Com problema").click()
    expect(pg.locator("#rodape-texto")).to_have_text("Mostrando 1–4 de 4 processamentos")
    pg.fill("#busca", "zeta")
    expect(pg.locator("#rodape-texto")).to_have_text("Mostrando 1–1 de 1 processamentos")
    assert "filtro=problema" in pg.url and "q=zeta" in pg.url and "mock_fila=2" in pg.url
    assert "mock_reset" not in pg.url  # vale uma vez só; senão o F5 apagaria o que foi criado
    pg.reload()  # F5 mantém filtros e o que foi criado (localStorage)
    expect(pg.locator("#rodape-texto")).to_have_text("Mostrando 1–1 de 1 processamentos")
    pg.fill("#busca", "")
    pg.get_by_role("button", name="Todos").click()
    expect(linhas(pg)).to_have_count(9)

    # --- detalhe de falha + reenviar ---
    pg.locator("#linhas tr", has_text="Teta Construções").get_by_role("button", name="Ver detalhes do processamento").click()
    expect(pg.locator("#dlg-detalhe")).to_be_visible()
    expect(pg.locator("#btn-reenviar")).to_be_visible()
    pg.screenshot(path=f"{CAPTURAS}/4_detalhe_falha.png")
    pg.click("#btn-reenviar")
    expect(pg.locator("#dlg-detalhe")).to_be_hidden()
    expect(pg.locator(".toast").last).to_contain_text("Reenvio aceito. Processamento 24863 na fila.")
    linha = pg.locator("#linhas tr", has_text="Teta Construções")
    assert "24863" in linha.inner_text() and "Na fila" in linha.inner_text()

    # --- detalhe com alertas ---
    pg.locator("#linhas tr", has_text="Épsilon").get_by_role("button", name="Ver detalhes do processamento").click()
    expect(pg.locator("#det-problemas")).to_contain_text("DOC_SEM_VINCULO")
    expect(pg.locator("#btn-reenviar")).to_be_hidden()
    pg.screenshot(path=f"{CAPTURAS}/5_detalhe_alertas.png")
    pg.keyboard.press("Escape")

    # --- texto do usuário nunca vira HTML ---
    pg.locator("[data-abrir-novo]").first.click()
    pg.fill("#nome", '<img src=x onerror="window.__xss=1">')
    pg.fill("#doc", "39053344705")
    pg.press("#doc", "Enter")
    pg.click("#btn-solicitar")
    expect(linhas(pg).first).to_contain_text("<img src=x")
    assert pg.evaluate("window.__xss") is None
    assert pg.locator("#linhas img").count() == 0

    # --- layout estreito ---
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.screenshot(path=f"{CAPTURAS}/6_mobile.png")
    pg.set_viewport_size({"width": 1440, "height": 1000})

    # --- falha de envio ao criar ---
    pg.goto(f"{base}/processamentos?mock_falha=1&mock_atraso=0&mock_reset=1")
    expect(linhas(pg)).to_have_count(8)
    pg.locator("[data-abrir-novo]").first.click()
    pg.fill("#nome", "Vai falhar")
    pg.fill("#doc", "52998224725")
    pg.press("#doc", "Enter")
    pg.click("#btn-solicitar")
    expect(pg.locator(".toast-erro")).to_contain_text("o envio ao BIG GLASS falhou")
    expect(linhas(pg).first).to_contain_text("Falha no envio")


def fluxo_http(pg, base, problemas):
    """Modo http: as APIs reais são respondidas pelo Playwright, no contrato do README."""
    api = {"modo": "ok", "prox": 555, "status": "NA FILA", "cod": 1, "inicio": "", "fim": ""}
    pedidos = []

    def responder(rota, req):
        partes = urlsplit(req.url)
        consulta = parse_qs(partes.query)
        pedidos.append((partes.path, consulta, req.headers.get("authentication")))
        if api["modo"] == "fora":
            return rota.abort()
        if api["modo"] == "auth":
            return rota.fulfill(status=409, content_type="application/json", body="{}")
        if api["modo"] == "erro500":
            return rota.fulfill(status=500, content_type="application/json", body="{}")
        if partes.path == "/api/processamento":
            api["prox"] += 1
            corpo = {"idProcessamento": api["prox"] - 1, "dataCadastro": "20261028_1000", "codStatus": 1, "status": "NA FILA"}
        else:
            ids = [int(i) for i in consulta["listaIdProcessamento"][0].split(",")]
            corpo = [{"idProcessamento": i, "codStatus": api["cod"], "status": api["status"], "dataCadastro": "20261028_1000",
                      "dataInicioProcessamento": api["inicio"], "dataFim": api["fim"]} for i in ids]
        return rota.fulfill(status=200, content_type="application/json", body=json.dumps(corpo))

    pg.route("**/api/**", responder)
    pg.goto(f"{base}/processamentos")
    expect(pg.locator("#lista-estado")).to_contain_text("Nenhum processamento encontrado")
    assert texto_rodape(pg) == "Nenhum resultado"
    assert not pedidos, "não deve chamar a API só para abrir a tela vazia"

    def criar(nome, docs):
        pg.locator("[data-abrir-novo]").first.click()
        pg.fill("#nome", nome)
        for d in docs:
            pg.fill("#doc", d)
            pg.press("#doc", "Enter")
        pg.click("#btn-solicitar")

    # --- criar: requisição conforme o contrato ---
    criar("Veio da API real", ["529.982.247-25", "11.222.333/0001-81"])
    expect(pg.locator(".toast")).to_contain_text("Processamento 555 criado")
    expect(linhas(pg)).to_have_count(1)
    caminho, consulta, auth = pedidos[0]
    assert caminho == "/api/processamento"
    assert consulta["nomeProcessamento"] == ["Veio da API real"]
    assert consulta["listaDocumento"] == ["52998224725|1,11222333000181|0"], consulta
    assert consulta["clienteSolicitante"] == ["01234"] and consulta["siglaOrgaoSolicitante"] == ["SEFAZ"]
    assert auth == "Bearer tok-e2e", auth
    texto = linhas(pg).first.inner_text()
    assert "555" in texto and "Na fila" in texto
    assert "28/10/2026 10:00" in texto and "10:00:00" not in texto  # a API só informa até o minuto
    pg.screenshot(path=f"{CAPTURAS}/http_1_criado.png")

    # --- status evolui pela API de status ---
    api.update(status="PROCESSANDO", cod=2, inicio="20261028_1005")
    pg.click("#btn-atualizar")
    expect(pg.locator(".toast").last).to_contain_text("Status sincronizados")
    expect(linhas(pg).first).to_contain_text("Processando")
    assert "28/10/2026 10:05" in linhas(pg).first.inner_text()
    assert pedidos[-1][0] == "/api/status" and pedidos[-1][1]["listaIdProcessamento"] == ["555"]
    assert pedidos[-1][2] == "Bearer tok-e2e"

    # --- status que a tela não conhece aparece com o texto da API ---
    api.update(status="EM ANÁLISE", cod=77)
    pg.click("#btn-atualizar")
    expect(linhas(pg).first).to_contain_text("EM ANÁLISE")
    api.update(status="CONCLUÍDO", cod=3, fim="20261028_1030")
    pg.click("#btn-atualizar")
    expect(linhas(pg).first).to_contain_text("Concluído")
    antes = len(pedidos)
    pg.click("#btn-atualizar")  # concluído é final: não precisa mais perguntar à API
    expect(pg.locator(".toast").last).to_contain_text("Status sincronizados")
    assert len(pedidos) == antes, "processamento concluído não deve ser consultado de novo"

    # --- detalhes: só mostra o que a API fornece ---
    pg.get_by_role("button", name="Ver detalhes do processamento").click()
    expect(pg.locator("#dlg-detalhe")).to_be_visible()
    expect(pg.locator("#det-c-orgao")).to_be_visible()
    assert pg.locator("#det-orgao").inner_text() == "SEFAZ"
    expect(pg.locator("#det-c-espaco")).to_be_hidden()
    expect(pg.locator("#det-c-ref")).to_be_hidden()
    pg.screenshot(path=f"{CAPTURAS}/http_2_detalhe.png")
    pg.keyboard.press("Escape")

    # --- a lista fica guardada no navegador (não há API de listagem) ---
    pg.reload()
    expect(linhas(pg)).to_have_count(1)
    assert "Veio da API real" in linhas(pg).first.inner_text()

    # --- 409: autenticação falhou ---
    api["modo"] = "auth"
    criar("Sem permissão", ["39053344705"])
    expect(pg.locator("#form-erro")).to_contain_text("Autenticação falhou")
    expect(pg.locator("#dlg-novo")).to_be_visible()  # continua aberto para corrigir
    pg.keyboard.press("Escape")
    expect(linhas(pg)).to_have_count(1)  # nada foi salvo

    # --- 500: registra a falha e permite reenviar ---
    api["modo"] = "erro500"
    criar("Vai falhar", ["39053344705"])
    expect(pg.locator(".toast-erro")).to_contain_text("o envio ao BIG GLASS falhou")
    expect(linhas(pg)).to_have_count(2)
    expect(linhas(pg).first).to_contain_text("Falha no envio")
    pg.locator("#linhas tr", has_text="Vai falhar").get_by_role("button", name="Ver detalhes do processamento").click()
    expect(pg.locator("#det-problemas")).to_contain_text("ENVIO_ERRO_API")
    pg.screenshot(path=f"{CAPTURAS}/http_3_falha.png")
    api["modo"] = "fora"
    pg.click("#btn-reenviar")
    expect(pg.locator("#det-erro")).to_contain_text("continua com problema")
    api.update(modo="ok", status="NA FILA", cod=1, inicio="", fim="")  # a API de status volta a dizer "NA FILA"
    pg.click("#btn-reenviar")
    expect(pg.locator("#dlg-detalhe")).to_be_hidden()
    expect(pg.locator(".toast").last).to_contain_text("Reenvio aceito. Processamento 556 na fila.")
    assert "Na fila" in pg.locator("#linhas tr", has_text="Vai falhar").inner_text()

    # --- API de status fora do ar: avisa e mantém os dados ---
    api["modo"] = "fora"
    pg.click("#btn-atualizar")
    expect(pg.locator(".toast-erro").last).to_contain_text("Não foi possível consultar o status")
    expect(linhas(pg)).to_have_count(2)


def main():
    mock_srv, mock_url = subir()
    http_srv, http_url = subir(API_MODO="http", API_URL_CRIAR="/api/processamento", API_URL_STATUS="/api/status",
                               API_TOKEN="tok-e2e", CLIENTE_SOLICITANTE="01234", SIGLA_ORGAO="SEFAZ")
    problemas = []
    try:
        with sync_playwright() as p:
            navegador = p.chromium.launch()
            for nome, fluxo, url in (("mock", fluxo_mock, mock_url), ("http", fluxo_http, http_url)):
                contexto = navegador.new_context(viewport={"width": 1440, "height": 1000})
                pg = contexto.new_page()
                pg.on("console", lambda m, n=nome: problemas.append(f"[{n}] console.{m.type}: {m.text}")
                      if m.type in ("error", "warning") else None)
                pg.on("pageerror", lambda e, n=nome: problemas.append(f"[{n}] pageerror: {e}"))
                fluxo(pg, url, problemas)
                print(f"fluxo {nome}: OK")
                contexto.close()
            navegador.close()
    finally:
        mock_srv.shutdown()
        http_srv.shutdown()

    # a aborto de rede de propósito gera um erro de console esperado
    reais = [p for p in problemas if "ERR_FAILED" not in p and "Failed to load resource" not in p]
    print("problemas de console/página:", reais or "nenhum")
    sys.exit(1 if reais else 0)


if __name__ == "__main__":
    main()
