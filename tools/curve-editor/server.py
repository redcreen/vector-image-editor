#!/usr/bin/env python3
"""Loopback-only curve editor. Versioned saves stay inside this project."""
import argparse
import json
import math
import os
import re
import threading
import uuid
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
SAVES = PROJECT / "work/curve_editor/sessions"
MAX_BODY = 32 * 1024 * 1024
ALLOWED = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"), "/style.css": ("style.css", "text/css"), "/app.js": ("app.js", "text/javascript"), "/geometry.js": ("geometry.js", "text/javascript"), "/interactions.js": ("interactions.js", "text/javascript")}


def number(v, limit=1e7):
    return type(v) in (int, float) and math.isfinite(v) and abs(v) <= limit


def validate(data):
    if not isinstance(data, dict) or data.get("format") != "daban-curve-editor" or data.get("version") != 1 or data.get("units") != "image-px":
        raise ValueError("修改文件格式无效")
    for k in ("width", "height"):
        if not number(data.get(k), 30000) or data[k] < 1:
            raise ValueError("画板尺寸无效")
    if not isinstance(data.get("paths"), list) or len(data["paths"]) > 500:
        raise ValueError("曲线数量无效")
    axis = data.get("mirrorAxis")
    if axis is not None:
        if not isinstance(axis, dict) or any(not isinstance(axis.get(k), dict) or not number(axis[k].get("x")) or not number(axis[k].get("y")) for k in ("a", "b")):
            raise ValueError("对称轴坐标无效")
        if math.hypot(axis["a"]["x"] - axis["b"]["x"], axis["a"]["y"] - axis["b"]["y"]) < 1e-6:
            raise ValueError("对称轴两点不能重合")
    ids = set()
    for p in data["paths"]:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or p["id"] in ids:
            raise ValueError("曲线标识无效")
        ids.add(p["id"])
        if not isinstance(p.get("nodes"), list) or len(p["nodes"]) > 10000:
            raise ValueError("节点数量无效")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", p.get("color", "")):
            raise ValueError("线色无效")
        for n in p["nodes"]:
            if not isinstance(n, dict):
                raise ValueError("节点无效")
            for v in (n, n.get("in"), n.get("out")):
                if not isinstance(v, dict) or not number(v.get("x")) or not number(v.get("y")):
                    raise ValueError("节点坐标无效")
    image = data.get("image")
    if image is not None and (not isinstance(image, dict) or not isinstance(image.get("name"), str) or not isinstance(image.get("dataUrl"), str) or not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+", image["dataUrl"])):
        raise ValueError("底图格式无效")


def preview_svg(data):
    w, h = data["width"], data["height"]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}px" height="{h}px" viewBox="0 0 {w} {h}">', '<desc>图像像素坐标，未标定毫米；修改沟通图，非生产切割版。</desc>']
    if data.get("image"):
        parts.append(f'<image width="{w}" height="{h}" href={quoteattr(data["image"]["dataUrl"])} opacity="0.65"/>')
    def pt(n):
        return f'{n["x"]:.6f} {n["y"]:.6f}'
    for p in data["paths"]:
        ns = p["nodes"]
        if not ns:
            continue
        d = "M " + pt(ns[0])
        for i in range(len(ns) - 1 + bool(p.get("closed"))):
            a, b = ns[i], ns[(i + 1) % len(ns)]
            d += f' C {pt(a["out"])} {pt(b["in"])} {pt(b)}'
        if p.get("closed"):
            d += " Z"
        parts.append(f'<path d={quoteattr(d)} fill="none" stroke={quoteattr(p["color"])} stroke-width="2"><title>{escape(str(p.get("name", "")))}</title><desc>{escape(str(p.get("note", "")))}</desc></path>')
    parts.append("</svg>")
    return "\n".join(parts)


def persist(data):
    validate(data)
    SAVES.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^\w\-\u4e00-\u9fff]+", "_", str(data.get("title", "改线")))[:60] or "改线"
    stem = f'{datetime.now().strftime("%Y%m%d_%H%M%S")}_{name}_{uuid.uuid4().hex[:6]}'
    data["savedAt"] = datetime.now().astimezone().isoformat()
    file = SAVES / (stem + ".json")
    # Unique immutable revisions; publish latest only after both outputs exist.
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    (SAVES / (stem + ".svg")).write_text(preview_svg(data), encoding="utf-8")
    temp = SAVES / ("latest-" + uuid.uuid4().hex + ".tmp")
    temp.write_text(file.name, encoding="utf-8")
    os.replace(temp, SAVES / "latest.txt")
    return {"filename": file.name, "path": str(file)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def allowed_host(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def respond(self, data, status=200, content_type="application/json; charset=utf-8"):
        if isinstance(data, (dict, list)) or data is None:
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        elif isinstance(data, str):
            data = data.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.allowed_host():
            return self.respond({"error": "Host denied"}, 403)
        path = urlsplit(self.path).path
        if path == "/api/health":
            return self.respond({"app": "daban-curve-editor-v1", "project": str(PROJECT), "saves": str(SAVES)})
        if path == "/api/latest":
            try:
                name = (SAVES / "latest.txt").read_text().strip()
                if Path(name).name != name or not name.endswith(".json"):
                    raise ValueError()
                return self.respond(json.loads((SAVES / name).read_text()))
            except (OSError, ValueError):
                return self.respond(None)
        if path not in ALLOWED:
            return self.respond({"error": "Not found"}, 404)
        name, mime = ALLOWED[path]
        return self.respond((ROOT / name).read_bytes(), content_type=mime)

    def do_POST(self):
        expected = f"http://{self.headers.get('Host')}"
        if not self.allowed_host() or self.headers.get("Origin") != expected or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin"):
            return self.respond({"error": "Only same-origin local saves are allowed"}, 403)
        if self.path != "/api/save":
            return self.respond({"error": "Not found"}, 404)
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.respond({"error": "Expected JSON"}, 415)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > MAX_BODY:
                return self.respond({"error": "文件超过32MB"}, 413)
            data = json.loads(self.rfile.read(size))
            result = persist(data)
            return self.respond(result)
        except (ValueError, TypeError, KeyError) as err:
            return self.respond({"error": str(err)}, 400)
        except OSError:
            return self.respond({"error": "本机文件保存失败，请下载备份"}, 500)


def main():
    global PROJECT, SAVES
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, default=PROJECT, help="修改文件所属的项目目录")
    parser.add_argument("--port", default="8767", help="端口号，或 auto 自动选择本机空闲端口")
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    PROJECT = args.project.expanduser().resolve()
    if not PROJECT.is_dir():
        parser.error("项目目录不存在：" + str(PROJECT))
    SAVES = PROJECT / "work/curve_editor/sessions"
    state_file = SAVES.parent / "server.json"

    def matching_server(port):
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=.5) as response:
                health = json.load(response)
            return (health.get("app") == "daban-curve-editor-v1"
                    and health.get("project") == str(PROJECT)
                    and health.get("saves") == str(SAVES))
        except (OSError, ValueError, AttributeError):
            return False

    def reuse(port):
        url = f"http://127.0.0.1:{port}"
        if args.open:
            webbrowser.open(url)
        print("通用矢量图编辑器已经运行：" + url, flush=True)
        print("修改保存在：" + str(SAVES), flush=True)

    if args.port == "auto":
        try:
            previous = json.loads(state_file.read_text())["port"]
            if type(previous) is int and 1 <= previous <= 65535 and matching_server(previous):
                return reuse(previous)
        except (OSError, ValueError, KeyError, TypeError):
            pass
        ports = range(8767, 8867)
    else:
        try:
            port = int(args.port)
            if not 1 <= port <= 65535:
                raise ValueError()
        except ValueError:
            parser.error("端口需为 1—65535 的整数或 auto")
        ports = [port]
    for port in ports:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            if matching_server(port):
                return reuse(port)
    else:
        raise SystemExit("端口被其他程序或项目占用；请使用 --port 指定另一个端口。")
    url = f"http://127.0.0.1:{port}"
    try:
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"port": port, "project": str(PROJECT)}, ensure_ascii=False))
    except OSError:
        server.server_close()
        raise SystemExit("无法写入项目目录：" + str(PROJECT))
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(url)).start()
    print("通用矢量图编辑器已启动：" + url, flush=True)
    print("修改保存在：" + str(SAVES), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
