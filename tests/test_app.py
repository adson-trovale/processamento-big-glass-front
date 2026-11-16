import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import create_app  # noqa: E402

RAIZ = os.path.join(os.path.dirname(__file__), "..")
JS_DIR = os.path.join(RAIZ, "static", "js")


class ServidorTest(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()

    def html(self):
        return self.client.get("/processamentos").get_data(as_text=True)

    def test_healthz(self):
        r = self.client.get("/healthz")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_data(as_text=True), "ok")
        self.assertEqual(r.headers["Cache-Control"], "no-store")

    def test_raiz_redireciona(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 302)
        self.assertTrue(r.headers["Location"].endswith("/processamentos"))

    def test_pagina_e_configuracao(self):
        html = self.html()
        self.assertIn('data-api-modo="mock"', html)
        self.assertIn('data-usuario="ana.souza"', html)
        self.assertNotIn("data-api-token", html)  # sem token configurado, nada vai para o HTML
        self.assertIn('type="module"', html)
        # blocos removidos da barra lateral
        self.assertNotIn("Configurações", html)
        self.assertNotIn("Ana Souza", html)
        self.assertNotIn("parceiro.com.br", html)

    def test_arquivos_estaticos(self):
        for caminho in ("/static/style.css", "/static/js/main.js", "/static/js/api-mock.js"):
            with self.client.get(caminho) as r:
                self.assertEqual(r.status_code, 200, caminho)
                if caminho.endswith("main.js"):
                    self.assertIn("javascript", r.headers["Content-Type"])

    def test_sem_estilo_ou_script_inline(self):
        html = self.html()
        self.assertIsNone(re.search(r"\sstyle=", html))
        self.assertIsNone(re.search(r"\son[a-z]+=", html))
        self.assertIsNone(re.search(r"<script(?![^>]*\bsrc=)", html))

    def test_cabecalhos(self):
        r = self.client.get("/processamentos")
        csp = r.headers["Content-Security-Policy"]
        self.assertIn("script-src 'self'", csp)
        self.assertIn("connect-src 'self'", csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        with self.client.get("/static/style.css") as estatico:
            self.assertNotIn("no-store", estatico.headers.get("Cache-Control", ""))

    def test_ids_usados_pelo_js_existem_no_html(self):
        html = self.html()
        ids_html = set(re.findall(r'\bid="([^"]+)"', html))
        usados = set()
        for nome in os.listdir(JS_DIR):
            with open(os.path.join(JS_DIR, nome), encoding="utf-8") as f:
                js = f.read()
            usados |= set(re.findall(r"\$\('#([\w-]+)'", js))
            usados |= set(re.findall(r"clonar\('([\w-]+)'\)", js))
        self.assertTrue(usados, "nenhum id encontrado no JS (regex quebrou?)")
        faltando = usados - ids_html
        self.assertFalse(faltando, f"ids usados no JS mas ausentes no HTML: {sorted(faltando)}")

    def test_modo_invalido(self):
        with self.assertRaises(ValueError):
            create_app({"API_MODO": "xyz"})

    HTTP = {
        "API_MODO": "http",
        "API_URL_CRIAR": "https://api.exemplo.com.br/processamento",
        "API_URL_STATUS": "https://status.exemplo.com.br/v1/status",
        "CLIENTE_SOLICITANTE": "01234",
        "SIGLA_ORGAO": "SEFAZ",
    }

    def test_modo_http_entrega_a_configuracao_e_libera_as_origens_no_csp(self):
        app = create_app({**self.HTTP, "API_TOKEN": "tok-secreto"})
        r = app.test_client().get("/processamentos")
        html = r.get_data(as_text=True)
        for trecho in ('data-api-modo="http"', 'data-api-url-criar="https://api.exemplo.com.br/processamento"',
                       'data-api-url-status="https://status.exemplo.com.br/v1/status"',
                       'data-cliente-solicitante="01234"', 'data-sigla-orgao="SEFAZ"', 'data-api-token="tok-secreto"'):
            self.assertIn(trecho, html)
        self.assertIn("connect-src 'self' https://api.exemplo.com.br https://status.exemplo.com.br;",
                      r.headers["Content-Security-Policy"])
        self.assertEqual(r.headers["Cache-Control"], "no-store")  # a página pode conter o token

    def test_modo_http_mesma_origem_nao_amplia_a_csp(self):
        app = create_app({**self.HTTP, "API_URL_CRIAR": "/api/processamento", "API_URL_STATUS": "/api/status"})
        csp = app.test_client().get("/processamentos").headers["Content-Security-Policy"]
        self.assertIn("connect-src 'self';", csp)

    def test_token_e_escapado_no_html(self):
        app = create_app({**self.HTTP, "API_TOKEN": 'x"><script>alert(1)</script>'})
        html = app.test_client().get("/processamentos").get_data(as_text=True)
        self.assertNotIn("<script>alert(1)", html)

    def test_modo_http_exige_configuracao_valida(self):
        for chave, valor in (("API_URL_CRIAR", ""), ("API_URL_STATUS", ""), ("CLIENTE_SOLICITANTE", "123"),
                             ("CLIENTE_SOLICITANTE", "abcde"), ("CLIENTE_SOLICITANTE", "123456"),
                             ("SIGLA_ORGAO", ""), ("SIGLA_ORGAO", "ABCDEFGHIJK")):
            with self.subTest(**{chave: valor}), self.assertRaises(ValueError):
                create_app({**self.HTTP, chave: valor})
        create_app({**self.HTTP, "SIGLA_ORGAO": "ABCDEFGHIJ"})  # 10 caracteres é o limite e passa

    def test_usuario_configuravel(self):
        app = create_app({"USUARIO_ATUAL": "joao.silva"})
        html = app.test_client().get("/processamentos").get_data(as_text=True)
        self.assertIn('data-usuario="joao.silva"', html)


if __name__ == "__main__":
    unittest.main()
