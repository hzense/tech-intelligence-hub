"""Trusted stdin/stdout bridge, invoked only inside the restricted Docker container."""
import base64
import json
import os
import runpy
import sys
import tempfile

os.umask(0o077)
try:
    packet = json.loads(sys.stdin.buffer.read(36 * 1024 * 1024 + 1))
    if set(packet) != {"parser", "format", "content"}:
        raise ValueError("invalid_packet")
    if packet["format"] not in ("pdf", "docx", "markdown", "text", "html", "csv", "xlsx"):
        raise ValueError("unsupported_content")
    if not isinstance(packet["parser"], str) or len(packet["parser"]) > 65536:
        raise ValueError("invalid_packet")
    content = base64.b64decode(packet["content"], validate=True)
    if not content or len(content) > 25 * 1024 * 1024:
        raise ValueError("limit_exceeded")
    with tempfile.TemporaryDirectory(prefix="hzense-parser-", dir="/tmp") as directory:
        source = os.path.join(directory, "source")
        parser = os.path.join(directory, "parser.py")
        result = os.path.join(directory, "result.json")
        with open(source, "wb") as stream:
            stream.write(content)
        with open(parser, "w", encoding="utf-8") as stream:
            stream.write(packet["parser"])
        sys.argv = [parser, source, packet["format"], result]
        runpy.run_path(parser, run_name="__main__")
        with open(result, "rb") as stream:
            output = stream.read(2000001)
        if len(output) > 2000000:
            raise ValueError("limit_exceeded")
        json.loads(output)
        sys.stdout.buffer.write(output)
except Exception:
    sys.stdout.write('{"error":"parse_failed"}')
