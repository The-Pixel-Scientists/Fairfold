# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The BI image (ADR 0039): the Apache Superset release image, pinned by
# digest, with only the packages in requirements.txt added or raised (each by
# version and hash, with their dependencies listed there too, and uv pip check
# confirming the set), and the settings, the init job and the starter
# dashboards copied in, so Compose and Helm run the same image. ADR 0039's
# ADR 0002 record names the release and digest. Build context: infra/bi.

FROM apache/superset:6.1.0@sha256:16b50bbef6648912a79e3293d418fefa743ce555d36c5af6b85d859119ed7f88

USER root
COPY requirements.txt /app/bi/requirements.txt
RUN . /app/.venv/bin/activate \
  && uv pip install --no-cache --require-hashes --no-deps -r /app/bi/requirements.txt \
  && uv pip check
COPY --chmod=0644 bi_settings.py superset_config.py import_dashboards.py /app/bi/
COPY --chmod=0755 init.sh /app/bi/init.sh
COPY dashboards /app/bi/dashboards
ENV SUPERSET_CONFIG_PATH=/app/bi/superset_config.py \
    PYTHONPATH=/app/bi \
    PYTHONDONTWRITEBYTECODE=1 \
    SCARF_ANALYTICS=false
USER superset
HEALTHCHECK --interval=10s --timeout=5s --start-period=2m --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8088/health', timeout=4)"]
