"""Servidor do front-end da tela de Processamentos BIG GLASS.

O Flask só entrega a página e os arquivos estáticos. Os dados vêm da camada de API em
JavaScript (static/js/api*.js): simulada no navegador (API_MODO=mock, padrão) ou
chamando as APIs reais (API_MODO=http). Veja o README.
"""
from __future__ import annotations

import os
import re
from urllib.parse import urlsplit

from flask import Flask, redirect, render_template, request, url_for

MODOS_API = ("mock", "http")


def _origem(url: str) -> str | None:
    """'https://host:porta/caminho' -> 'https://host:porta'; None se for relativa (mesma origem)."""
    partes = urlsplit(url)
    return f"{partes.scheme}://{partes.netloc}" if partes.scheme and partes.netloc else None


def _validar_modo_http(cfg) -> None:
    if not cfg["API_URL_CRIAR"]:
        raise ValueError("API_URL_CRIAR é obrigatória quando API_MODO=http (URL da API de processamento).")
    if not cfg["API_URL_STATUS"]:
        raise ValueError("API_URL_STATUS é obrigatória quando API_MODO=http (URL da API de status).")
    if not re.fullmatch(r"\d{5}", cfg["CLIENTE_SOLICITANTE"]):
        raise ValueError("CLIENTE_SOLICITANTE deve ter exatamente 5 dígitos (5 primeiros do CPF do solicitante).")
    if not 1 <= len(cfg["SIGLA_ORGAO"]) <= 10:
        raise ValueError("SIGLA_ORGAO é obrigatória e deve ter no máximo 10 caracteres.")


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(
        API_MODO=os.environ.get("API_MODO", "mock"),   # mock | http
        API_URL_CRIAR=os.environ.get("API_URL_CRIAR", ""),
        API_URL_STATUS=os.environ.get("API_URL_STATUS", ""),
        # Atenção: se definido, o token vai dentro do HTML da página. Veja o README.
        API_TOKEN=os.environ.get("API_TOKEN", ""),
        CLIENTE_SOLICITANTE=os.environ.get("CLIENTE_SOLICITANTE", ""),
        SIGLA_ORGAO=os.environ.get("SIGLA_ORGAO", ""),
        USUARIO_ATUAL=os.environ.get("USUARIO_ATUAL", "ana.souza"),
    )
    if config:
        app.config.update(config)

    if app.config["API_MODO"] not in MODOS_API:
        raise ValueError(f"API_MODO deve ser um de {MODOS_API}, recebido: {app.config['API_MODO']!r}")
    if app.config["API_MODO"] == "http":
        _validar_modo_http(app.config)

    @app.get("/healthz")
    def healthz():
        """Verificação de saúde para Docker/orquestradores (não depende das APIs externas)."""
        return "ok", 200, {"Content-Type": "text/plain; charset=utf-8"}

    @app.get("/")
    def inicio():
        return redirect(url_for("processamentos"))

    @app.get("/processamentos")
    def processamentos():
        return render_template(
            "index.html",
            api_modo=app.config["API_MODO"],
            api_url_criar=app.config["API_URL_CRIAR"],
            api_url_status=app.config["API_URL_STATUS"],
            api_token=app.config["API_TOKEN"],
            cliente_solicitante=app.config["CLIENTE_SOLICITANTE"],
            sigla_orgao=app.config["SIGLA_ORGAO"],
            usuario=app.config["USUARIO_ATUAL"],
        )

    @app.after_request
    def cabecalhos(resp):
        connect = ["'self'"]
        if app.config["API_MODO"] == "http":
            for url in (app.config["API_URL_CRIAR"], app.config["API_URL_STATUS"]):
                origem = _origem(url)
                if origem and origem not in connect:
                    connect.append(origem)
        resp.headers["Content-Security-Policy"] = (
            f"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
            f"connect-src {' '.join(connect)}; object-src 'none'; base-uri 'self'; "
            "form-action 'self'; frame-ancestors 'none'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "same-origin"
        if request.endpoint != "static":
            resp.headers["Cache-Control"] = "no-store"
        return resp

    return app


if __name__ == "__main__":
    create_app().run(debug=os.environ.get("FLASK_DEBUG") == "1")
