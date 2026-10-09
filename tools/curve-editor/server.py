#!/usr/bin/env python3
"""Loopback-only curve editor. Versioned saves stay inside this project."""
import argparse
import copy
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
from urllib.request import build_opener, ProxyHandler
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
SAVES = PROJECT / "work/curve_editor/sessions"
LOOPBACK_HTTP = build_opener(ProxyHandler({}))
MAX_BODY = 32 * 1024 * 1024
ALLOWED = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"), "/style.css": ("style.css", "text/css"), "/app.js": ("app.js", "text/javascript"), "/geometry.js": ("geometry.js", "text/javascript"), "/interactions.js": ("interactions.js", "text/javascript"), "/layers.js": ("layers.js", "text/javascript"), "/tracing.js": ("tracing.js", "text/javascript")}
ALLOWED.update({"/offset.js": ("offset.js", "text/javascript"), "/vendor/clipper.js": ("vendor/clipper.js", "text/javascript")})
IMAGE_DATA_URL = re.compile(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+")
EDITOR_TOOLS = {"node", "select", "pen", "pan", "axis", "measure", "calibrate", "trace"}


def number(v, limit=1e7):
    return type(v) in (int, float) and math.isfinite(v) and abs(v) <= limit


def validate_editor_state(state, snapshot=False):
    if not isinstance(state, dict):
        raise ValueError("编辑状态无效")
    required = {"selected", "ni", "selection", "imageSelection", "activeLayer", "nodeSelection", "drawing", "tool"}
    if not required.issubset(state) or (snapshot and "doc" not in state) or (not snapshot and "doc" in state):
        raise ValueError("编辑状态无效")
    if state["selected"] is not None and not isinstance(state["selected"], str):
        raise ValueError("编辑状态无效")
    if state["activeLayer"] is not None and not isinstance(state["activeLayer"], str):
        raise ValueError("编辑状态无效")
    if state["ni"] is not None and (type(state["ni"]) is not int or not 0 <= state["ni"] <= 10000):
        raise ValueError("编辑状态无效")
    if (not isinstance(state["selection"], list)
            or not all(isinstance(value, str) for value in state["selection"])
            or not isinstance(state["imageSelection"], list)
            or not all(isinstance(value, str) for value in state["imageSelection"])
            or not isinstance(state["nodeSelection"], list)):
        raise ValueError("编辑状态无效")
    for node in state["nodeSelection"]:
        if (not isinstance(node, dict) or not isinstance(node.get("pathId"), str)
                or type(node.get("index")) is not int or not 0 <= node["index"] <= 10000):
            raise ValueError("编辑状态无效")
    if type(state["drawing"]) is not bool or state["tool"] not in EDITOR_TOOLS:
        raise ValueError("编辑状态无效")


def unpack_history_document(document, assets):
    if not isinstance(document, dict) or "operationHistory" in document:
        raise ValueError("历史快照文件无效")
    unpacked = copy.deepcopy(document)
    images = []
    if unpacked.get("image") is not None:
        images.append(unpacked["image"])
    if isinstance(unpacked.get("images"), list):
        images.extend(unpacked["images"])
    for image in images:
        if not isinstance(image, dict):
            raise ValueError("历史快照图片无效")
        reference = image.get("dataUrl")
        if (not isinstance(reference, dict) or set(reference) != {"asset"}
                or type(reference["asset"]) is not int
                or not 0 <= reference["asset"] < len(assets)):
            raise ValueError("历史快照图片引用无效")
        image["dataUrl"] = assets[reference["asset"]]
    return unpacked


def validate_operation_history(operation_history):
    if (not isinstance(operation_history, dict)
            or operation_history.get("format") != "curve-editor-session"
            or operation_history.get("version") != 1
            or not isinstance(operation_history.get("assets"), list)
            or not isinstance(operation_history.get("data"), dict)):
        raise ValueError("操作记录格式无效")
    assets = operation_history["assets"]
    if (not all(isinstance(value, str) and IMAGE_DATA_URL.fullmatch(value) for value in assets)
            or len(set(assets)) != len(assets)):
        raise ValueError("操作记录图片无效")
    session = operation_history["data"]
    if not isinstance(session.get("current"), dict) or not isinstance(session.get("history"), dict):
        raise ValueError("操作记录数据无效")
    validate_editor_state(session["current"])
    history = session["history"]
    if history.get("version") != 1:
        raise ValueError("操作记录版本无效")
    keys = ("past", "future", "pastLabels", "futureLabels")
    if not all(isinstance(history.get(key), list) for key in keys):
        raise ValueError("操作记录数据无效")
    if len(history["past"]) + len(history["future"]) > 100:
        raise ValueError("操作记录数量无效")
    if len(history["past"]) != len(history["pastLabels"]) or len(history["future"]) != len(history["futureLabels"]):
        raise ValueError("操作记录标签无效")
    if not all(isinstance(label, str) and len(label) <= 200 for label in history["pastLabels"] + history["futureLabels"]):
        raise ValueError("操作记录标签无效")
    for snapshot in history["past"] + history["future"]:
        validate_editor_state(snapshot, snapshot=True)
        validate(unpack_history_document(snapshot["doc"], assets), allow_operation_history=False)


def validate(data, allow_operation_history=True):
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
    calibration = data.get("calibration")
    if calibration is not None:
        if not isinstance(calibration, dict):
            raise ValueError("物理标定无效")
        points = []
        for key in ("a", "b"):
            point = calibration.get(key)
            if not isinstance(point, dict) or not number(point.get("x")) or not number(point.get("y")):
                raise ValueError("物理标定坐标无效")
            points.append(point)
        length = calibration.get("length")
        unit = calibration.get("unit")
        if not number(length) or length <= 0 or unit not in ("mm", "cm"):
            raise ValueError("物理标定长度或单位无效")
        pixels = math.hypot(points[0]["x"] - points[1]["x"], points[0]["y"] - points[1]["y"])
        if pixels < 1e-6:
            raise ValueError("物理标定两点不能重合")
        millimeters_per_pixel = length * (10 if unit == "cm" else 1) / pixels
        if not math.isfinite(millimeters_per_pixel) or millimeters_per_pixel <= 0:
            raise ValueError("物理标定比例无效")
    if "measureUnit" in data and data["measureUnit"] not in ("mm", "cm"):
        raise ValueError("测量显示单位无效")
    ids = set()
    for p in data["paths"]:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or p["id"] in ids:
            raise ValueError("曲线标识无效")
        ids.add(p["id"])
        if not isinstance(p.get("nodes"), list) or len(p["nodes"]) > 10000:
            raise ValueError("节点数量无效")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", p.get("color", "")):
            raise ValueError("线色无效")
        if "dashed" in p and type(p["dashed"]) is not bool:
            raise ValueError("虚线标记无效")
        for n in p["nodes"]:
            if not isinstance(n, dict):
                raise ValueError("节点无效")
            for v in (n, n.get("in"), n.get("out")):
                if not isinstance(v, dict) or not number(v.get("x")) or not number(v.get("y")):
                    raise ValueError("节点坐标无效")
    image = data.get("image")
    if image is not None and (not isinstance(image, dict) or not isinstance(image.get("name"), str) or not isinstance(image.get("dataUrl"), str) or not IMAGE_DATA_URL.fullmatch(image["dataUrl"])):
        raise ValueError("底图格式无效")
    if "layers" in data or "images" in data:
        layers, images = data.get("layers"), data.get("images")
        if not isinstance(layers, list) or not 1 <= len(layers) <= 200:
            raise ValueError("图层数量无效")
        if not isinstance(images, list) or len(images) > 200:
            raise ValueError("图片数量无效")

        image_ids = set()
        for item in images:
            if (not isinstance(item, dict)
                    or not isinstance(item.get("id"), str) or not item["id"].strip() or len(item["id"]) > 200 or item["id"] in image_ids
                    or not isinstance(item.get("name"), str)
                    or not isinstance(item.get("dataUrl"), str)
                    or not IMAGE_DATA_URL.fullmatch(item["dataUrl"])
                    or not number(item.get("x")) or not number(item.get("y"))
                    or not number(item.get("width")) or item["width"] <= 0
                    or not number(item.get("height")) or item["height"] <= 0
                    or not number(item.get("opacity"), 1) or item["opacity"] < 0):
                raise ValueError("图片数据无效")
            image_ids.add(item["id"])

        layer_ids = set()
        path_references, image_references = [], []
        for layer in layers:
            if (not isinstance(layer, dict)
                    or not isinstance(layer.get("id"), str) or not layer["id"].strip() or len(layer["id"]) > 200 or layer["id"] in layer_ids
                    or not isinstance(layer.get("name"), str)
                    or type(layer.get("visible")) is not bool or type(layer.get("locked")) is not bool
                    or not isinstance(layer.get("pathIds"), list)
                    or not all(isinstance(value, str) for value in layer["pathIds"])
                    or not isinstance(layer.get("imageIds"), list)
                    or not all(isinstance(value, str) for value in layer["imageIds"])):
                raise ValueError("图层数据无效")
            layer_ids.add(layer["id"])
            path_references.extend(layer["pathIds"])
            image_references.extend(layer["imageIds"])
        if len(path_references) != len(ids) or set(path_references) != ids:
            raise ValueError("图层曲线引用无效")
        if len(image_references) != len(image_ids) or set(image_references) != image_ids:
            raise ValueError("图层图片引用无效")
    if "operationHistory" in data:
        if not allow_operation_history:
            raise ValueError("历史快照不得嵌套操作记录")
        validate_operation_history(data["operationHistory"])


def export_bounds(data):
    width, height = data["width"], data["height"]
    min_x, min_y, max_x, max_y = 0, 0, width, height

    def cubic_value(p0, p1, p2, p3, t):
        u = 1 - t
        return u**3 * p0 + 3 * u*u*t * p1 + 3 * u*t*t * p2 + t**3 * p3

    def extrema(p0, p1, p2, p3):
        a = -p0 + 3*p1 - 3*p2 + p3
        b = 3*p0 - 6*p1 + 3*p2
        c = -3*p0 + 3*p1
        qa, qb = 3*a, 2*b
        if abs(qa) < 1e-12:
            roots = [] if abs(qb) < 1e-12 else [-c/qb]
        else:
            discriminant = qb*qb - 4*qa*c
            roots = [] if discriminant < 0 else [(-qb-math.sqrt(discriminant))/(2*qa), (-qb+math.sqrt(discriminant))/(2*qa)]
        return [t for t in roots if 0 < t < 1]

    if "layers" in data:
        path_by_id = {path["id"]: path for path in data["paths"]}
        image_by_id = {image["id"]: image for image in data["images"]}
        visible_layers = [layer for layer in data["layers"] if layer["visible"]]
        paths = [path_by_id[path_id] for layer in visible_layers for path_id in layer["pathIds"]]
        images = [image_by_id[image_id] for layer in visible_layers for image_id in layer["imageIds"]]
    else:
        paths, images = data["paths"], []

    for image in images:
        min_x = min(min_x, image["x"])
        min_y = min(min_y, image["y"])
        max_x = max(max_x, image["x"] + image["width"])
        max_y = max(max_y, image["y"] + image["height"])

    for path in paths:
        nodes = path["nodes"]
        if not nodes:
            continue
        points = [(nodes[0]["x"], nodes[0]["y"])]
        for index in range(len(nodes) - 1 + bool(path.get("closed"))):
            start, end = nodes[index], nodes[(index + 1) % len(nodes)]
            parameters = set(extrema(start["x"], start["out"]["x"], end["in"]["x"], end["x"]))
            parameters.update(extrema(start["y"], start["out"]["y"], end["in"]["y"], end["y"]))
            points.append((end["x"], end["y"]))
            points.extend((
                cubic_value(start["x"], start["out"]["x"], end["in"]["x"], end["x"], t),
                cubic_value(start["y"], start["out"]["y"], end["in"]["y"], end["y"], t)
            ) for t in parameters)
        min_x = min(min_x, *(point[0] for point in points))
        min_y = min(min_y, *(point[1] for point in points))
        max_x = max(max_x, *(point[0] for point in points))
        max_y = max(max_y, *(point[1] for point in points))

    padding = 4
    if min_x < 0:
        min_x -= padding
    if min_y < 0:
        min_y -= padding
    if max_x > width:
        max_x += padding
    if max_y > height:
        max_y += padding
    return min_x, min_y, max_x - min_x, max_y - min_y


def preview_svg(data):
    image_w, image_h = data["width"], data["height"]
    x, y, w, h = export_bounds(data)
    fmt = lambda value: f'{value:.12g}'
    calibration = data.get("calibration")
    if calibration:
        pixels = math.hypot(calibration["a"]["x"] - calibration["b"]["x"], calibration["a"]["y"] - calibration["b"]["y"])
        millimeters_per_pixel = calibration["length"] * (10 if calibration["unit"] == "cm" else 1) / pixels
        description = f'图像保持像素坐标；已按用户两点标定，1 px = {millimeters_per_pixel:.12g} mm；修改沟通图，非生产切割版。'
    else:
        description = '图像像素坐标，未标定毫米；修改沟通图，非生产切割版。'
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(w)}px" height="{fmt(h)}px" viewBox="{fmt(x)} {fmt(y)} {fmt(w)} {fmt(h)}">', f'<desc>{description}</desc>']
    if data.get("image"):
        parts.append(f'<image width="{image_w}" height="{image_h}" href={quoteattr(data["image"]["dataUrl"])} opacity="0.65"/>')

    def image_element(image):
        return (f'<image x="{fmt(image["x"])}" y="{fmt(image["y"])}" '
                f'width="{fmt(image["width"])}" height="{fmt(image["height"])}" '
                f'href={quoteattr(image["dataUrl"])} opacity="{fmt(image["opacity"])}" preserveAspectRatio="none">'
                f'<title>{escape(image["name"])}</title></image>')

    def pt(n):
        return f'{n["x"]:.6f} {n["y"]:.6f}'

    def path_element(p):
        ns = p["nodes"]
        if not ns:
            return None
        d = "M " + pt(ns[0])
        for i in range(len(ns) - 1 + bool(p.get("closed"))):
            a, b = ns[i], ns[(i + 1) % len(ns)]
            d += f' C {pt(a["out"])} {pt(b["in"])} {pt(b)}'
        if p.get("closed"):
            d += " Z"
        dash = ' stroke-dasharray="8 6"' if p.get("dashed") is True else ''
        return f'<path d={quoteattr(d)} fill="none" stroke={quoteattr(p["color"])} stroke-width="2"{dash}><title>{escape(str(p.get("name", "")))}</title><desc>{escape(str(p.get("note", "")))}</desc></path>'

    if "layers" in data:
        path_by_id = {path["id"]: path for path in data["paths"]}
        image_by_id = {image["id"]: image for image in data["images"]}
        for layer in data["layers"]:
            if not layer["visible"]:
                continue
            parts.extend(image_element(image_by_id[image_id]) for image_id in layer["imageIds"])
            parts.extend(element for path_id in layer["pathIds"] if (element := path_element(path_by_id[path_id])))
    else:
        parts.extend(element for path in data["paths"] if (element := path_element(path)))
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


class LocalServer(ThreadingHTTPServer):
    # Browsers prefetch the editor scripts together; keep this burst off the
    # platform's tiny default accept queue instead of resetting connections.
    request_queue_size = 64


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
            return self.respond({"app": "daban-curve-editor-v1", "project": str(PROJECT), "saves": str(SAVES), "editorRevision": "portable-history-v1"})
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
            with LOOPBACK_HTTP.open(f"http://127.0.0.1:{port}/api/health", timeout=.5) as response:
                health = json.load(response)
            return (health.get("app") == "daban-curve-editor-v1"
                    and health.get("project") == str(PROJECT)
                    and health.get("editorRevision") == "portable-history-v1"
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
            server = LocalServer(("127.0.0.1", port), Handler)
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
