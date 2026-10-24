"""Import HP-GL pen polylines without guessing unsupported plotter transforms.

Plotter coordinates are 1/40 mm; the editor uses downward-positive Y.
Reference: HP PCL 5 Color Technical Reference, HP-GL/2 Units of Measure.
https://www.hp.com/ctg/Manual/bpl13211.pdf
"""
import copy
import math
import re
from pathlib import Path

NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)'
NUMBERS = re.compile(NUMBER + r'(?:(?:\s*,\s*|\s+)' + NUMBER + r')*')
COMMAND = re.compile(r'([A-Za-z]{2})([^A-Za-z;]*)')
MAX_NODES = 10000
MAX_PATHS = 500
MAX_LAYERS = 200
MAX_TOTAL_NODES = 200000


def _numbers(text, command):
    text = text.strip()
    if not text:
        return []
    if not NUMBERS.fullmatch(text):
        raise ValueError(f'PLT {command} 参数无效')
    values = [float(n) for n in re.findall(NUMBER, text)]
    if not all(math.isfinite(n) for n in values):
        raise ValueError(f'PLT {command} 参数超出范围')
    return values


def import_plt(data, filename):
    try:
        text = data.decode('ascii')
    except UnicodeDecodeError as exc:
        raise ValueError('PLT 仅支持 ASCII HP-GL 线稿；文件含无法识别的内容') from exc
    paths, layers, warnings = [], {}, []
    position = (0.0, 0.0)
    absolute, down, pen = True, False, 1
    points, total = [], 0

    def flush():
        nonlocal points
        if len(points) < 2:
            points = []
            return
        # Relative decimal moves can accumulate sub-nanometre floating error.
        closed = len(points) >= 4 and all(math.isclose(a, b, rel_tol=1e-14, abs_tol=1e-8)
                                         for a, b in zip(points[-1], points[0]))
        if closed:
            points.pop()
        if len(points) > MAX_NODES or len(paths) >= MAX_PATHS:
            raise ValueError('PLT 曲线或节点数量超出限制')
        path_id = f'plt-path-{len(paths) + 1}'
        nodes = []
        for x, y in points:
            point = {'x': x / 40, 'y': -y / 40}
            nodes.append({**point, 'in': dict(point), 'out': dict(point), 'mode': 'cusp'})
        paths.append({'id': path_id, 'name': f'PLT 曲线 {len(paths) + 1}',
                      'role': 'outline', 'color': '#163d58', 'closed': closed,
                      'visible': True, 'note': f'Imported from PLT pen {pen}', 'nodes': nodes})
        if pen not in layers:
            if len(layers) >= MAX_LAYERS:
                raise ValueError('PLT 笔号图层数量超出限制')
            layers[pen] = {'id': f'plt-pen-{pen}', 'name': f'PLT 笔 {pen}',
                           'visible': True, 'locked': False, 'pathIds': [], 'imageIds': [], 'textIds': []}
        layers[pen]['pathIds'].append(path_id)
        points = []

    offset = 0
    while offset < len(text):
        if text[offset] in ' \t\r\n;':
            offset += 1
            continue
        match = COMMAND.match(text, offset)
        if not match:
            raise ValueError(f'PLT 指令无效（位置 {offset + 1}）')
        command = match[1].upper()
        if command not in ('IN', 'SP', 'PU', 'PD', 'PA', 'PR', 'VS', 'PW', 'WU', 'LT', 'SC'):
            raise ValueError(f'PLT 暂不支持 {command} 指令，未导入；请输出 HP-GL 折线格式')
        values = _numbers(match[2], command)
        offset = match.end()
        if command == 'IN':
            if values:
                raise ValueError('PLT IN 参数无效')
            flush()
            position, absolute, down, pen = (0.0, 0.0), True, False, 1
        elif command == 'SP':
            if len(values) > 1 or (values and (not values[0].is_integer() or not 0 <= values[0] <= 255)):
                raise ValueError('PLT SP 笔号无效')
            flush()
            pen = int(values[0]) if values else 0
        elif command in ('LT', 'SC'):
            # Empty LT selects solid lines; empty SC disables user scaling.
            if values:
                raise ValueError(f'PLT 暂不支持带参数的 {command} 指令，未导入')
        elif command in ('VS', 'PW', 'WU'):
            if ((command in ('VS', 'PW') and (len(values) > 2 or any(v < 0 for v in values)))
                    or (command == 'WU' and values not in ([], [0], [1]))):
                raise ValueError(f'PLT {command} 参数无效')
            if command == 'PW' and 'PLT 笔宽按编辑器默认线宽显示' not in warnings:
                warnings.append('PLT 笔宽按编辑器默认线宽显示')
        else:
            if len(values) % 2:
                raise ValueError(f'PLT {command} 坐标必须成对')
            if command == 'PU':
                flush()
                down = False
            elif command == 'PD':
                down = True
            else:
                absolute = command == 'PA'
            for i in range(0, len(values), 2):
                destination = (values[i], values[i + 1])
                if not absolute:
                    destination = (position[0] + destination[0], position[1] + destination[1])
                if any(not math.isfinite(v) or abs(v / 40) > 1e7 for v in destination):
                    raise ValueError('PLT 坐标超出支持范围')
                if down and destination != position:
                    if pen == 0:
                        raise ValueError('PLT SP0 未选笔时含绘图指令，无法确定线稿')
                    if not points:
                        points.append(position)
                        total += 1
                    points.append(destination)
                    total += 1
                    if len(points) > MAX_NODES + 1 or total > MAX_TOTAL_NODES:
                        raise ValueError('PLT 节点数量超出限制')
                position = destination
    flush()
    if not paths:
        raise ValueError('PLT 不含可导入的线稿')
    # Canvas dimensions have a 30000 limit; the infinite canvas still preserves
    # larger valid coordinates, including plotter origins far from the artwork.
    extent = min(30000, max(1.0, max(abs(n[k]) for p in paths for n in p['nodes'] for k in ('x', 'y'))))
    document = {'format': 'daban-curve-editor', 'version': 1,
                'title': Path(filename).stem[:200] or 'PLT import',
                'width': extent, 'height': extent, 'units': 'image-px', 'newNodeMode': 'cusp',
                'image': None, 'opacity': 0.65, 'images': [], 'texts': [],
                'paths': paths, 'layers': list(layers.values()), 'originals': copy.deepcopy(paths),
                'calibration': {'a': {'x': 0, 'y': 0}, 'b': {'x': 1, 'y': 0}, 'length': 1, 'unit': 'mm'},
                'measureUnit': 'mm'}
    return {'document': document, 'warnings': warnings, 'sourceUnit': '0.025mm'}
