FROM python:3.14-slim-bookworm@sha256:48b13b003dda20b16f9442b8475aa05fe21bf6579a8c881db92ffb4d8fd20f83
LABEL org.hzense.local-parser="1"
COPY requirements.txt /opt/hzense/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r /opt/hzense/requirements.txt
COPY import-runner.py /opt/hzense/import-runner.py
USER 65532:65532
ENTRYPOINT ["python3", "-I", "/opt/hzense/import-runner.py"]
