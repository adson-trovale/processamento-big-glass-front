# Tela de Processamentos BIG GLASS (Flask servindo o front-end) — imagem de produção.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Usuário sem privilégios (o app não grava nada em disco).
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

# Dependências primeiro, para aproveitar o cache de camadas.
COPY requirements.txt .
RUN pip install -r requirements.txt "gunicorn>=23,<24"

# Só o que a aplicação precisa para rodar (testes, README etc. ficam de fora).
COPY app.py ./
COPY templates ./templates
COPY static ./static

# Configuração do gunicorn por variável de ambiente (sobrescreva com -e / environment).
#  - worker-tmp-dir em /dev/shm permite rodar com o sistema de arquivos somente leitura
#  - WEB_CONCURRENCY define o número de processos
ENV GUNICORN_CMD_ARGS="--bind=0.0.0.0:8000 --threads=2 --worker-tmp-dir=/dev/shm --access-logfile=- --error-logfile=-" \
    WEB_CONCURRENCY=2

USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"]

# "app:create_app()" usa a fábrica do Flask. Em API_MODO=http o app recusa subir
# se a configuração estiver incompleta (o container sai com a mensagem no log).
CMD ["gunicorn", "app:create_app()"]
