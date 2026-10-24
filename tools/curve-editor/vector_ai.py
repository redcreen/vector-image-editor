"""Bounded, non-executing AI vector codec (legacy Illustrator and PDF compatible AI).

The editable model represents strokes only. Anything requiring clipping, fills,
text, images, transparency, arbitrary PostScript or unsupported PDF operators is
rejected rather than silently flattened or dropped. Coordinates are normalized
by translation and converted from PostScript points to millimetres.
"""
import base64
import io
import math
from pathlib import Path
import re
import sys
import zlib

MAX_BYTES = 32 * 1024 * 1024
MAX_TOKENS = 1500000
PT_MM = 25.4 / 72
IDENTITY = (1., 0., 0., 1., 0., 0.)


def _error(message):
    raise ValueError('AI：' + message)


def _number(value):
    try:
        n = float(value)
    except (ValueError, TypeError, OverflowError):
        _error('坐标或参数不是有效数字')
    if not math.isfinite(n) or abs(n) > 1e9:
        _error('坐标或参数超出安全范围')
    return n


def _matrix(a, b):
    return (a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
            a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
            a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5])


def _decode_name(raw):
    for encoding in ('utf-8', 'gb18030', 'mac_roman'):
        try:
            return raw.decode(encoding)[:80]
        except UnicodeDecodeError:
            pass
    return '图层'


def _tokens(data):
    """Small lexer, deliberately not a PostScript interpreter."""
    text = data.decode('latin1')
    i = count = 0
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if c == '%':
            while i < len(text) and text[i] not in '\r\n':
                i += 1
            continue
        count += 1
        if count > MAX_TOKENS:
            _error('指令数量超过上限')
        if c == '(':
            i += 1
            depth = 1
            out = bytearray()
            while i < len(text) and depth:
                c = text[i]
                i += 1
                if c == '\\':
                    if i >= len(text):
                        _error('字符串转义不完整')
                    c = text[i]
                    i += 1
                    if c in '01234567':
                        digits = c
                        while len(digits) < 3 and i < len(text) and text[i] in '01234567':
                            digits += text[i]
                            i += 1
                        out.append(int(digits, 8) % 256)
                    elif c in '\r\n':
                        if c == '\r' and i < len(text) and text[i] == '\n':
                            i += 1
                    else:
                        out.append(ord({'n':'\n', 'r':'\r', 't':'\t', 'b':'\b', 'f':'\f'}.get(c, c)))
                elif c == '(':
                    depth += 1
                    if depth > 32:
                        _error('字符串嵌套过深')
                    out.append(ord(c))
                elif c == ')':
                    depth -= 1
                    if depth:
                        out.append(ord(c))
                else:
                    out.append(ord(c))
                if len(out) > 65536:
                    _error('字符串过长')
            if depth:
                _error('字符串未结束')
            yield bytes(out)
            continue
        if c in '[]':
            yield c
            i += 1
            continue
        if c in '{}<>/)':
            _error('不支持的 PostScript 程序、资源或二进制结构')
        end = i
        while end < len(text) and not text[end].isspace() and text[end] not in '[]()%{}<>/':
            end += 1
        token = text[i:end]
        i = end
        if re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', token):
            yield _number(token)
        else:
            yield token


class _Geometry:
    def __init__(self):
        self.paths = []
        self.layers = []
        self.layer = None
        self.pending = []
        self.current = None
        self.ctm = IDENTITY
        self.color = '#000000'
        self.dashed = False
        self.stack = []

    def point(self, x, y):
        x, y = _number(x), _number(y)
        a,b,c,d,e,f = self.ctm
        return {'x': _number(a*x+c*y+e), 'y': _number(b*x+d*y+f)}

    def node(self, pt):
        return dict(pt, **{'in': dict(pt), 'out': dict(pt), 'mode': 'cusp'})

    def new_layer(self, name='图层'):
        if self.pending:
            _error('图层边界处存在未完成路径')
        if len(self.layers) >= 200:
            _error('图层数量超过 200')
        self.layer = {'id': 'ai-layer-' + str(len(self.layers)+1), 'name': name,
                      'visible': True, 'locked': False, 'pathIds': [], 'imageIds': [], 'textIds': []}
        self.layers.append(self.layer)

    def move(self, x, y):
        if len(self.paths) + len(self.pending) >= 500:
            _error('曲线数量超过 500')
        self.current = {'nodes': [self.node(self.point(x,y))], 'closed': False}
        self.pending.append(self.current)

    def line(self, x, y):
        if self.current is None or self.current['closed']:
            _error('路径缺少起点，或闭合后继续绘制')
        if len(self.current['nodes']) >= 9999:
            _error('单条曲线节点数必须小于 10000')
        self.current['nodes'].append(self.node(self.point(x,y)))
        self.current['_lastCubic'] = False

    def cubic(self, values, op='c'):
        if self.current is None or self.current['closed']:
            _error('贝塞尔曲线缺少起点')
        old = self.current['nodes'][-1]
        if op.lower() == 'v':
            c1 = {'x': old['x'], 'y': old['y']}
            c2 = self.point(*values[:2])
            end = values[2:]
        elif op.lower() == 'y':
            c1 = self.point(*values[:2])
            end = values[2:]
            c2 = self.point(*end)
        else:
            c1 = self.point(*values[:2])
            c2 = self.point(*values[2:4])
            end = values[4:]
        self.line(*end)
        old['out'] = c1
        self.current['nodes'][-1]['in'] = c2
        self.current['_lastCubic'] = True

    def close(self):
        if self.current is None:
            _error('闭合指令缺少路径')
        nodes = self.current['nodes']
        if (self.current.get('_lastCubic') and len(nodes) > 2 and
                nodes[-1]['x'] == nodes[0]['x'] and nodes[-1]['y'] == nodes[0]['y']):
            nodes[0]['in'] = nodes[-1]['in']
            nodes.pop()
        self.current['closed'] = True

    def paint(self, close=False):
        if not self.pending:
            _error('描边指令缺少路径')
        if close:
            self.close()
        if self.layer is None:
            self.new_layer_for_pending()
        for p in self.pending:
            if len(p['nodes']) < 2:
                _error('路径至少需要两个节点')
            p.pop('_lastCubic', None)
            # The editor closes only >=3-node paths. Split the closing segment
            # exactly, including both handles, to represent a two-node loop.
            if p['closed'] and len(p['nodes']) == 2:
                a, b = p['nodes'][-1], p['nodes'][0]
                def midpoint(x, y):
                    return {k: (x[k]+y[k])/2 for k in ('x','y')}
                q0 = midpoint(a, a['out'])
                q1 = midpoint(a['out'], b['in'])
                q2 = midpoint(b['in'], b)
                r0, r1 = midpoint(q0,q1), midpoint(q1,q2)
                middle = self.node(midpoint(r0,r1))
                a['out'], b['in'] = q0, q2
                middle['in'], middle['out'] = r0, r1
                p['nodes'].append(middle)
            pid = 'ai-path-' + str(len(self.paths)+1)
            p.update(id=pid, name='曲线 ' + str(len(self.paths)+1), role='outline',
                     color=self.color, dashed=self.dashed, note='')
            self.paths.append(p)
            self.layer['pathIds'].append(pid)
        self.pending = []
        self.current = None

    def new_layer_for_pending(self):
        pending, current = self.pending, self.current
        self.pending, self.current = [], None
        self.new_layer()
        self.pending, self.current = pending, current

    def rgb(self, values):
        if any(n < 0 or n > 1 for n in values):
            _error('颜色值超出范围')
        self.color = '#' + ''.join('%02x' % round(v*255) for v in values)

    def save(self):
        if len(self.stack) >= 32:
            _error('图形状态嵌套过深')
        self.stack.append((self.ctm, self.color, self.dashed))

    def restore(self):
        if not self.stack:
            _error('图形状态恢复没有配对的保存')
        self.ctm, self.color, self.dashed = self.stack.pop()

    def document(self, filename):
        if self.pending:
            _error('文件包含未完成或未描边的路径')
        if self.stack:
            _error('图形状态保存与恢复不配对')
        if not self.paths:
            _error('没有可编辑的描边曲线')
        points = [p for path in self.paths for n in path['nodes'] for p in (n, n['in'], n['out'])]
        xmin = min(p['x'] for p in points)
        xmax = max(p['x'] for p in points)
        ymin = min(p['y'] for p in points)
        ymax = max(p['y'] for p in points)
        if max(xmax-xmin, ymax-ymin)*PT_MM > 30000:
            _error('图形尺寸超过编辑器的 30000 毫米画板上限')
        for p in points:
            p['x'] = (p['x']-xmin)*PT_MM
            p['y'] = (ymax-p['y'])*PT_MM
        return {'format':'daban-curve-editor', 'version':1, 'title':Path(filename).stem[:200],
                'width':max(1, (xmax-xmin)*PT_MM), 'height':max(1, (ymax-ymin)*PT_MM),
                'units':'image-px', 'newNodeMode':'cusp', 'image':None, 'opacity':0.65,
                'paths':self.paths, 'layers':self.layers, 'images':[], 'texts':[],
                'calibration':{'a':{'x':0,'y':0}, 'b':{'x':1,'y':0}, 'length':1,'unit':'mm'},
                'measureUnit':'mm'}


def _parse_ps(data):
    if not data.startswith(b'%!PS-Adobe-'):
        _error('不是受支持的 Illustrator PostScript 文件')
    # Resource programs are never evaluated. Only the declared artwork section
    # is parsed. Trailer and page trailer cannot contain artwork in this subset.
    if b'%%EndSetup' in data:
        data = data.split(b'%%EndSetup', 1)[1]
    elif b'%%EndProlog' in data:
        data = data.split(b'%%EndProlog', 1)[1]
    elif b'%%EndComments' in data:
        data = data.split(b'%%EndComments', 1)[1]
    else:
        _error('缺少可识别的 AI 图形段标记')
    data = re.split(br'(?m)^%%(?:PageTrailer|Trailer)\b', data, maxsplit=1)[0]
    g = _Geometry()
    args = []
    array = None
    ignored = {'w':1, 'J':1, 'j':1, 'M':1, 'R':1, 'XR':1, 'Xy':5,
               'i':1, 'u':0, 'U':0, '*u':0, '*U':0, 'showpage':0,
               'g':1, 'k':4, 'rg':3, 'xa':3}
    for token in _tokens(data):
        if token == '[':
            if array is not None:
                _error('不支持嵌套数组')
            array = []
            continue
        if token == ']':
            if array is None:
                _error('数组未配对')
            args.append(array)
            array = None
            continue
        if array is not None:
            if not isinstance(token, float):
                _error('数组中仅允许数字')
            array.append(token)
            if len(array) > 1000:
                _error('数组过长')
            continue
        if isinstance(token, (float, bytes)):
            args.append(token)
            if len(args) > 1000:
                _error('参数栈过长')
            continue
        op = token
        counts = {'m':2,'l':2,'L':2,'c':6,'C':6,'v':4,'V':4,'y':4,'Y':4,
                  'h':0,'H':0,'s':0,'S':0,'RG':3,'XA':3,'G':1,'K':4,
                  'Lb':10,'Ln':1,'LB':0,'gsave':0,'grestore':0,
                  'concat':1,'translate':2,'scale':2,'rotate':1,'d':2}
        expected = counts.get(op, ignored.get(op))
        if expected is None:
            _error('不支持的指令 %s；仅支持无填充、无裁剪的描边曲线，文字和图片请先移除' % str(op)[:80])
        if len(args) != expected:
            _error('指令 %s 参数数量不正确' % op)
        if op not in ('Ln','concat','d') and any(not isinstance(n, float) for n in args):
            _error('指令 %s 参数类型不正确' % op)
        if op == 'm': g.move(*args)
        elif op in ('l','L'): g.line(*args)
        elif op in ('c','C','v','V','y','Y'): g.cubic(args, op)
        elif op in ('h','H'): g.close()
        elif op in ('s','S'): g.paint(op == 's')
        elif op in ('RG','XA'): g.rgb(args)
        elif op == 'G': g.rgb(args*3)
        elif op == 'K':
            if any(n < 0 or n > 1 for n in args): _error('CMYK 颜色值超出范围')
            g.rgb([(1-n)*(1-args[3]) for n in args[:3]])
        elif op == 'Lb':
            g.new_layer()
            g.layer['visible'] = bool(args[0])
        elif op == 'Ln':
            if not isinstance(args[0], bytes): _error('图层名称必须为字符串')
            if g.layer is None: g.new_layer()
            g.layer['name'] = _decode_name(args[0]) or '图层'
        elif op == 'LB':
            if g.pending: _error('图层结束处存在未完成路径')
            g.layer = None
        elif op == 'gsave': g.save()
        elif op == 'grestore': g.restore()
        elif op == 'concat':
            if not isinstance(args[0], list) or len(args[0]) != 6: _error('变换矩阵必须包含六个数字')
            g.ctm = _matrix(g.ctm, args[0])
        elif op == 'translate': g.ctm = _matrix(g.ctm, (1,0,0,1,*args))
        elif op == 'scale': g.ctm = _matrix(g.ctm, (args[0],0,0,args[1],0,0))
        elif op == 'rotate':
            theta = math.radians(args[0]); c,s = math.cos(theta),math.sin(theta)
            g.ctm = _matrix(g.ctm, (c,s,-s,c,0,0))
        elif op == 'd':
            if not isinstance(args[0], list) or not isinstance(args[1], float): _error('虚线参数无效')
            g.dashed = bool(args[0])
        args = []
    if args or array is not None:
        _error('文件末尾存在不完整参数')
    return g


def _stream_data(stream, limit=None):
    """Decode only bounded, audited filters; never call unbounded get_data()."""
    limit = MAX_BYTES if limit is None else min(limit, MAX_BYTES)
    if limit <= 0:
        _error('PDF 解码总量超过上限')
    stream = stream.get_object()
    data = stream._data
    if not isinstance(data, bytes) or len(data) > MAX_BYTES:
        _error('数据流过大或无效')
    filters = stream.get('/Filter', [])
    if isinstance(filters, str): filters = [filters]
    if len(filters) > 4: _error('数据流过滤层级过深')
    parms = stream.get('/DecodeParms')
    if parms and (not isinstance(parms, dict) or parms.get('/Predictor', 1) != 1):
        _error('不支持此数据流预测编码')
    for filt in filters:
        try:
            if filt in ('/ASCIIHexDecode','/AHx'):
                encoded = re.sub(br'\s+', b'', data)
                if encoded.endswith(b'>'): encoded = encoded[:-1]
                if len(encoded) % 2: encoded += b'0'
                if len(encoded) // 2 > limit: _error('PDF 解码总量超过上限')
                data = bytes.fromhex(encoded.decode('ascii'))
            elif filt in ('/FlateDecode','/Fl'):
                decoder = zlib.decompressobj()
                data = decoder.decompress(data, limit+1)
                if len(data) > limit or decoder.unconsumed_tail or not decoder.eof:
                    _error('解压数据超过上限或压缩流损坏')
            elif filt in ('/ASCII85Decode','/A85'):
                raw = data.strip()
                if raw.startswith(b'<~'): raw = raw[2:]
                if raw.endswith(b'~>'): raw = raw[:-2]
                # ASCII85 z expands to four zero bytes, so input length alone
                # does not bound expansion. Count the maximum before decoding.
                compact = re.sub(br'\s+', b'', raw)
                zeros = compact.count(b'z')
                digits = len(compact)-zeros
                predicted = zeros*4 + (digits//5)*4 + max(0, digits % 5-1)
                if predicted > limit: _error('PDF 解码总量超过上限')
                data = base64.a85decode(raw)
            else:
                _error('不支持的数据流编码 %s' % filt)
        except (ValueError, zlib.error, UnicodeError) as exc:
            if str(exc).startswith('AI：'): raise
            _error('数据流损坏或无法解码')
        if len(data) > limit: _error('PDF 解码总量超过上限')
    if len(data) > limit: _error('PDF 解码总量超过上限')
    return data


class _DecodeBudget:
    """One decoded-byte allowance shared by structural and artwork streams."""
    def __init__(self):
        self.used = 0
        self.cache = {}

    def decode(self, stream):
        stream = stream.get_object()
        entry = self.cache.get(id(stream))
        if entry is not None:
            return entry[1]
        decoded = _stream_data(stream, MAX_BYTES-self.used)
        self.used += len(decoded)
        # Retain identity as well as bytes to prevent id reuse after collection.
        self.cache[id(stream)] = (stream, decoded)
        return decoded


def _parse_pdf(data):
    vendor = str(Path(__file__).resolve().parent / 'vendor' / 'python')
    if vendor not in sys.path: sys.path.insert(0, vendor)
    try:
        from pypdf import PdfReader
        from pypdf.generic import ContentStream, DecodedStreamObject, StreamObject
    except ImportError:
        _error('缺少内置 PDF 解析组件，请更新编辑器安装')
    budget = _DecodeBudget()

    class BoundedPdfReader(PdfReader):
        # In the bundled pypdf, both xref streams and resolved object streams
        # pass through this cache BEFORE get_data() is called. Intercept on the
        # individual stream instance: no global monkeypatch and no cross-request
        # limits. This also covers private streams and content streams.
        def cache_indirect_object(self, generation, idnum, obj):
            if isinstance(obj, StreamObject):
                obj.get_data = lambda: budget.decode(obj)
            return super().cache_indirect_object(generation, idnum, obj)

        def _rebuild_xref_table(self, stream):
            # pypdf's damaged-xref recovery decodes uncached object streams.
            # Refuse recovery rather than bypass the per-document budget.
            _error('PDF 交叉引用损坏，无法安全重建；请在原软件重新另存 AI')

    try:
        reader = BoundedPdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted: _error('不支持加密 AI 文件')
        if len(reader.pages) != 1: _error('暂不支持多画板 PDF 兼容 AI，请逐画板导出')
        page = reader.pages[0]
        # Illustrator private data is authoritative, as CorelDRAW may put a blank
        # preview in the PDF page. Refuse unknown private versions rather than
        # mistaking that preview for the editable artwork.
        piece = page.get('/PieceInfo')
        if piece:
            piece = piece.get_object()
            illustrator = piece.get('/Illustrator')
            if illustrator:
                private = illustrator.get_object().get('/Private')
                if private:
                    private = private.get_object()
                    keys = [k for k in private if str(k).startswith('/AIPrivateData')]
                    if keys:
                        if keys != ['/AIPrivateData1']:
                            _error('暂不支持分段 Illustrator 私有数据，请另存为 Illustrator 8')
                        return _parse_ps(budget.decode(private['/AIPrivateData1']))
        if page.get('/Annots'): _error('不支持包含注释对象的 AI 页面')
        if page.get('/Rotate', 0) % 360: _error('暂不支持旋转的 PDF 页面，请在原软件应用页面旋转')
        contents = page.get('/Contents')
        if contents is None: _error('AI 页面没有可编辑内容')
        contents = contents.get_object()
        streams = contents if isinstance(contents, list) else [contents]
        if len(streams) > 100: _error('PDF 内容流过多')
        parts = []
        total = 0
        for stream in streams:
            part = budget.decode(stream)
            total += len(part)
            if total > MAX_BYTES: _error('PDF 解码总量超过上限')
            parts.append(part)
        body = b'\n'.join(parts)
        # Preflight token/nesting bounds before the third-party PDF token parser.
        depth = 0
        for token in _tokens(body):
            if token == '[':
                depth += 1
                if depth > 32: _error('PDF 数组嵌套过深')
            elif token == ']':
                depth -= 1
                if depth < 0: _error('PDF 数组未配对')
        if depth: _error('PDF 数组未结束')
        decoded = DecodedStreamObject()
        decoded.set_data(body)
        ops = ContentStream(decoded, reader).operations
        if len(ops) > MAX_TOKENS: _error('PDF 指令过多')
        g = _Geometry()
        userunit = _number(page.get('/UserUnit', 1))
        if userunit <= 0: _error('PDF UserUnit 必须为正数')
        g.ctm = (userunit,0,0,userunit,0,0)
        ignored = {b'w':1,b'J':1,b'j':1,b'M':1,b'i':1,b'RG':3,b'G':1,b'K':4,
                   b'rg':3,b'g':1,b'k':4}
        for values, op in ops:
            counts = {b'm':2,b'l':2,b'c':6,b'v':4,b'y':4,b'h':0,b'S':0,b's':0,
                      b're':4,b'q':0,b'Q':0,b'cm':6,b'd':2,b'n':0}
            expected = counts.get(op, ignored.get(op))
            if expected is None:
                _error('PDF 包含不支持的 %s 指令（文字、图片、填充、裁剪或外部对象），请导出纯描边 Illustrator 8' % op.decode('latin1')[:40])
            if len(values) != expected: _error('PDF 指令参数数量不正确')
            a = [_number(v) for v in values] if op != b'd' else values
            if op == b'm': g.move(*a)
            elif op == b'l': g.line(*a)
            elif op in (b'c',b'v',b'y'): g.cubic(a, op.decode())
            elif op == b'h': g.close()
            elif op in (b'S',b's'): g.paint(op == b's')
            elif op == b're':
                x,y,w,h = a
                g.move(x,y); g.line(x+w,y); g.line(x+w,y+h); g.line(x,y+h); g.close()
            elif op == b'q': g.save()
            elif op == b'Q': g.restore()
            elif op == b'cm': g.ctm = _matrix(g.ctm, a)
            elif op == b'RG': g.rgb(a)
            elif op == b'G': g.rgb(a*3)
            elif op == b'K':
                if any(n < 0 or n > 1 for n in a): _error('颜色值超出范围')
                g.rgb([(1-n)*(1-a[3]) for n in a[:3]])
            elif op == b'd':
                if not isinstance(a[0], list) or len(a[0]) > 1000: _error('虚线参数无效')
                for v in a[0]: _number(v)
                _number(a[1]); g.dashed = bool(a[0])
            elif op == b'n' and g.pending:
                _error('PDF 包含未描边的路径，无法无损导入')
        return g
    except ValueError as exc:
        if str(exc).startswith('AI：'): raise
        _error('PDF 结构损坏：' + str(exc)[:150])
    except Exception as exc:
        _error('无法读取 PDF 兼容 AI：' + str(exc)[:150])


def import_ai(data, filename):
    if not isinstance(data, bytes) or not data or len(data) > MAX_BYTES:
        _error('文件为空或超过 32MB 上限')
    geometry = _parse_pdf(data) if data.startswith(b'%PDF-') else _parse_ps(data)
    return {'document':geometry.document(filename), 'warnings':[
        'AI 点单位已按 1/72 英寸换算为毫米；保留描边中心线，线宽与虚线间距不作为加工轮廓。'], 'sourceUnit':'pt'}


def export_ai(document):
    if document.get('image') or document.get('images') or document.get('texts'):
        _error('AI 导出仅支持曲线，请移除图片与文字')
    try:
        cal = document['calibration']
        unit = cal['unit']
        if unit not in ('mm', 'cm'): _error('标定单位必须为 mm 或 cm')
        length = _number(cal['length']) * (10 if unit == 'cm' else 1)
        distance = math.hypot(_number(cal['b']['x'])-_number(cal['a']['x']),
                              _number(cal['b']['y'])-_number(cal['a']['y']))
        if length <= 0 or distance <= 0: _error('导出需要有效的实际尺寸标定')
        scale = length / distance / PT_MM
    except (KeyError, TypeError):
        _error('导出前请先用已知长度标定实际尺寸')
    paths = document.get('paths', [])
    if not paths or len(paths) > 500: _error('导出曲线数量必须为 1–500')
    allpoints = []
    for path in paths:
        nodes = path.get('nodes', [])
        if not 2 <= len(nodes) < 10000: _error('每条曲线需要 2–9999 个节点')
        for n in nodes:
            for pt in (n,n.get('in',n),n.get('out',n)):
                allpoints.append((_number(pt['x'])*scale, -_number(pt['y'])*scale))
    xmin = min(p[0] for p in allpoints); xmax = max(p[0] for p in allpoints)
    ymin = min(p[1] for p in allpoints); ymax = max(p[1] for p in allpoints)
    def fmt(v):
        v = _number(v)
        return ('%.10f' % v).rstrip('0').rstrip('.') or '0'
    def point(n):
        return fmt(_number(n['x'])*scale-xmin) + ' ' + fmt(-_number(n['y'])*scale-ymin)
    def string(s):
        return '(' + ''.join(chr(b) if 32 <= b < 127 and chr(b) not in '()\\' else '\\%03o' % b
                             for b in str(s)[:80].encode('utf-8')) + ')'
    width, height = xmax-xmin, ymax-ymin
    lines = ['%!PS-Adobe-3.0 EPSF-3.0', '%%Creator: Curve Editor (Adobe Illustrator compatible)',
             '%%Title: Editable curves', '%%%%BoundingBox: 0 0 %d %d' % (math.ceil(width),math.ceil(height)),
             '%%%%HiResBoundingBox: 0 0 %s %s' % (fmt(width),fmt(height)),
             '%%DocumentData: Clean7Bit', '%%LanguageLevel: 2', '%%Pages: 1',
             '%AI3_ColorUsage: Color', '%AI3_DocumentPreview: None', '%%EndComments',
             '%%BeginProlog', '/m {moveto} bind def', '/L {lineto} bind def', '/C {curveto} bind def',
             '/S {stroke} bind def', '/s {closepath stroke} bind def', '/h {closepath} bind def',
             '/RG {setrgbcolor} bind def', '/XA {setrgbcolor} bind def', '/w {setlinewidth} bind def',
             '/d {setdash} bind def', '/Lb {10 {pop} repeat} bind def', '/Ln {pop} bind def', '/LB {} bind def',
             '%%EndProlog', '%%BeginSetup', '%%EndSetup', '%%Page: 1 1', '0.5 w']
    byid = {p['id']:p for p in paths}
    if len(byid) != len(paths): _error('曲线 id 重复')
    layers = document.get('layers') or [{'name':'曲线', 'pathIds':list(byid)}]
    if len(layers) > 200: _error('图层超过 200')
    seen = set()
    for layer in layers:
        ids = layer.get('pathIds', [])
        if not ids: continue
        lines += ['%AI5_BeginLayer', '1 1 1 1 0 0 0 0 0 0 Lb', string(layer.get('name','曲线'))+' Ln']
        for pid in ids:
            if pid not in byid or pid in seen: _error('图层曲线归属无效')
            seen.add(pid)
            path = byid[pid]
            color = path.get('color', '#000000')
            if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): _error('曲线颜色无效')
            lines.append(' '.join(fmt(int(color[i:i+2],16)/255) for i in (1,3,5))+' XA')
            lines.append('[8 6] 0 d' if path.get('dashed') else '[] 0 d')
            nodes = path['nodes']
            lines.append(point(nodes[0])+' m')
            pairs = list(zip(nodes, nodes[1:]))
            if path.get('closed'): pairs.append((nodes[-1], nodes[0]))
            for a,b in pairs:
                ao, bi = a.get('out',a), b.get('in',b)
                if ao['x'] == a['x'] and ao['y'] == a['y'] and bi['x'] == b['x'] and bi['y'] == b['y']:
                    # Closing straight edge is supplied by s, avoiding duplicate nodes.
                    if path.get('closed') and a is nodes[-1]: continue
                    lines.append(point(b)+' L')
                else:
                    lines.append(point(ao)+' '+point(bi)+' '+point(b)+' C')
            lines.append('s' if path.get('closed') else 'S')
        lines += ['LB', '%AI5_EndLayer--']
    if seen != set(byid): _error('存在未归属图层的曲线')
    lines += ['%%PageTrailer','showpage','%%Trailer','%%EOF','']
    return '\n'.join(lines).encode('ascii')
