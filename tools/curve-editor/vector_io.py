"""Local vector file exchange: explicit units and visible layer selection."""
import base64
import binascii
import copy
import math
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

MAX_IMPORT_BYTES = 16 * 1024 * 1024


class ImportUnitRequiredError(ValueError):
    needs_unit = True


def import_file(filename, encoded, unit=None):
    if not isinstance(filename, str) or len(filename) > 250:
        raise ValueError('文件名无效')
    extension = Path(filename).suffix.lower()
    if extension not in ('.ai', '.dxf', '.plt'):
        raise ValueError('请选择 AI、DXF 或 PLT 文件')
    if not isinstance(encoded, str) or len(encoded) > (MAX_IMPORT_BYTES + 2) // 3 * 4:
        raise ValueError('矢量文件超过 16MB')
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError('矢量文件编码无效') from exc
    if not data or len(data) > MAX_IMPORT_BYTES:
        raise ValueError('矢量文件为空或超过 16MB')
    if extension == '.ai':
        from vector_ai import import_ai
        return import_ai(data, Path(filename).name)
    if extension == '.plt':
        from vector_plt import import_plt
        return import_plt(data, Path(filename).name)
    from vector_dxf import import_dxf, MissingUnitsError
    try:
        return import_dxf(data, Path(filename).name, unit_override=unit)
    except MissingUnitsError as exc:
        raise ImportUnitRequiredError(str(exc)) from exc


def millimeters_per_pixel(doc):
    c = doc.get('calibration')
    if not isinstance(c, dict):
        raise ValueError('尚未设置实际尺寸比例，请先在测量面板完成两点标定')
    try:
        length = c['length']
        distance = math.hypot(c['b']['x'] - c['a']['x'], c['b']['y'] - c['a']['y'])
        if type(length) not in (int, float) or c['unit'] not in ('mm', 'cm') or length <= 0 or distance <= 1e-6:
            raise ValueError()
        scale = length * (10 if c['unit'] == 'cm' else 1) / distance
        if not math.isfinite(scale) or scale <= 0:
            raise ValueError()
        return scale
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError('实际尺寸比例无效，请重新标定') from exc


def scope_document(doc, layer_ids=None):
    """Flatten selected visible subtrees without exporting hidden originals."""
    layers = doc.get('layers') or [{'id':'default','name':'曲线图层','visible':True,'locked':False,
                                  'pathIds':[p['id'] for p in doc['paths']], 'imageIds':[], 'textIds':[t['id'] for t in doc.get('texts', [])]}]
    by_id = {layer['id']:layer for layer in layers}
    if layer_ids is not None:
        if not isinstance(layer_ids, list) or not layer_ids or any(not isinstance(i, str) or i not in by_id for i in layer_ids):
            raise ValueError('请选择有效的导出图层')
        chosen = set(layer_ids)
    else:
        chosen = set(by_id)
    result = copy.deepcopy({key:value for key,value in doc.items() if key not in ('paths','layers','images','texts','operationHistory','originals')})
    result.update(paths=[], layers=[], images=[], texts=[], originals=[], image=None)
    source_texts = doc.get('texts', [])
    if any('dimension' in text for text in source_texts):
        from vector_dimension import resolve_dimension
        source_texts = [resolve_dimension(text, doc.get('calibration'), doc.get('paths', []))
                        if 'dimension' in text else text for text in source_texts]
    sources = {'paths': doc.get('paths', []), 'images': doc.get('images', []),
               'texts': source_texts}
    known = {kind:{item['id']:item for item in sources[key]}
             for kind,key in [('path','paths'),('image','images'),('text','texts')]}
    def chain(layer):
        sequence=[];seen=set()
        while layer:
            if layer['id'] in seen:raise ValueError('图层组循环归属')
            seen.add(layer['id']);sequence.append(layer)
            layer=by_id.get(layer.get('parentId'))
        return list(reversed(sequence))
    def ordered(parent=None):
        for layer in layers:
            if layer.get('parentId')==parent:
                if layer.get('kind')=='group':yield from ordered(layer['id'])
                else:yield layer
    for layer in ordered():
        lineage=chain(layer)
        if not any(l['id'] in chosen for l in lineage) or not all(l.get('visible',True) for l in lineage):continue
        target={'id':layer['id'],'name':' / '.join(l['name'] for l in lineage),'visible':True,'locked':layer.get('locked',False),'pathIds':[],'imageIds':[],'textIds':[],'items':[]}
        items=layer.get('items')
        if items is None:items=[{'type':kind,'id':id} for kind,ref in [('image','imageIds'),('path','pathIds'),('text','textIds')] for id in layer.get(ref,[])]
        for item in items:
            kind=item['type'];source=known[kind][item['id']]
            if item.get('visible',True) is False or source.get('visible',True) is False:continue
            if kind=='path' and not source.get('nodes'):continue
            key={'path':'paths','image':'images','text':'texts'}[kind]
            result[key].append(copy.deepcopy(source));target[kind+'Ids'].append(source['id']);target['items'].append({'type':kind,'id':source['id']})
        if target['items']:result['layers'].append(target)
    if doc.get('image') and layer_ids is None:
        raise ValueError('导出范围包含旧底图，请选择仅含矢量内容的图层')
    if not result['layers']:
        raise ValueError('所选范围没有可见内容；隐藏图层和隐藏曲线不导出')
    return result


def _axis_extrema(a, b, c, d):
    # derivative / 3 = A*t*t + B*t + C
    aa=-a+3*b-3*c+d;bb=2*(a-2*b+c);cc=b-a
    roots=[]
    if abs(aa)<1e-14:
        if abs(bb)>1e-14:roots=[-cc/bb]
    else:
        disc=bb*bb-4*aa*cc
        if disc>=0:
            roots=[(-bb-math.sqrt(disc))/(2*aa),(-bb+math.sqrt(disc))/(2*aa)]
    values=[a,d]
    for t in roots:
        if 0<t<1:values.append((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d)
    return values


def _marker_geometry(text):
    marker = text.get('positionMarker')
    if marker is None:return None
    angle=math.radians(text.get('rotation',0));offset=text['fontSize']*.6
    return {
        'x':marker['x'],'y':marker['y'],'radius':text['fontSize']*.16,
        'leaderX':text['x']-math.sin(angle)*offset,
        'leaderY':text['y']+math.cos(angle)*offset,
    }


def content_bounds(doc):
    xs=[];ys=[]
    for path in doc['paths']:
        nodes=path['nodes']
        for node in nodes:xs.append(node['x']);ys.append(node['y'])
        for i in range(max(0,len(nodes)-1)+int(bool(path.get('closed')) and len(nodes)>1)):
            a=nodes[i];b=nodes[(i+1)%len(nodes)]
            xs.extend(_axis_extrema(a['x'],a['out']['x'],b['in']['x'],b['x']))
            ys.extend(_axis_extrema(a['y'],a['out']['y'],b['in']['y'],b['y']))
    for t in doc.get('texts',[]):
        lines=t['content'].replace('\r\n','\n').replace('\r','\n').split('\n')
        width=max(map(len,lines))*t['fontSize']*1.2;height=len(lines)*t['fontSize']*1.2
        angle=math.radians(t.get('rotation',0));cosine=math.cos(angle);sine=math.sin(angle)
        for offset_x in (0,width):
            for offset_y in (0,height):
                xs.append(t['x']+cosine*offset_x-sine*offset_y)
                ys.append(t['y']+sine*offset_x+cosine*offset_y)
        marker=_marker_geometry(t)
        if marker:
            xs.extend((marker['x']-marker['radius'],marker['x']+marker['radius'],marker['leaderX']))
            ys.extend((marker['y']-marker['radius'],marker['y']+marker['radius'],marker['leaderY']))
        if 'dimension' in t:
            from vector_dimension import dimension_segments
            for start,end in dimension_segments(t):
                xs.extend((start['x'],end['x']));ys.extend((start['y'],end['y']))
    if not xs:raise ValueError('没有可以导出的曲线或文字')
    return min(xs),min(ys),max(xs)-min(xs),max(ys)-min(ys)


def _fmt(value):
    if not math.isfinite(value):raise ValueError('坐标或尺寸无效')
    return format(value, '.12g')


def _svg(doc, scale):
    x,y,w,h=content_bounds(doc)
    # Horizontal / vertical line art still needs a non-zero SVG viewport.
    w=max(w,1e-6);h=max(h,1e-6)
    output=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{_fmt(w*scale)}mm" height="{_fmt(h*scale)}mm" viewBox="{_fmt(x)} {_fmt(y)} {_fmt(w)} {_fmt(h)}">',f'<title>{escape(str(doc.get("title","矢量作品")))}</title>',f'<desc>1 坐标单位 = {_fmt(scale)} mm；按当前实际比例导出。</desc>']
    paths={p['id']:p for p in doc['paths']};texts={t['id']:t for t in doc['texts']}
    for layer in doc['layers']:
        output.append(f'<g id={quoteattr(layer["id"])}><title>{escape(layer["name"])}</title>')
        for item in layer['items']:
            if item['type']=='path':
                p=paths[item['id']];ns=p['nodes'];d=f'M {_fmt(ns[0]["x"])} {_fmt(ns[0]["y"])}'
                for index in range(len(ns)-1+int(bool(p.get('closed')) and len(ns)>1)):
                    a=ns[index];b=ns[(index+1)%len(ns)]
                    d+=f' C {_fmt(a["out"]["x"])} {_fmt(a["out"]["y"])} {_fmt(b["in"]["x"])} {_fmt(b["in"]["y"])} {_fmt(b["x"])} {_fmt(b["y"])}'
                if p.get('closed'):d+=' Z'
                dash=' stroke-dasharray="8 6"' if p.get('dashed') else ''
                output.append(f'<path d="{d}" fill="none" stroke={quoteattr(p["color"])} stroke-width="1"{dash}><title>{escape(p.get("name",""))}</title></path>')
            elif item['type']=='text':
                t=texts[item['id']]
                if 'dimension' in t:
                    from vector_dimension import dimension_segments
                    for start,end in dimension_segments(t):
                        output.append(f'<line x1="{_fmt(start["x"])}" y1="{_fmt(start["y"])}" x2="{_fmt(end["x"])}" y2="{_fmt(end["y"])}" stroke={quoteattr(t["color"])} stroke-width="{_fmt(t["fontSize"]*.06)}"/>')
                marker=_marker_geometry(t)
                if marker:
                    color=quoteattr(t['color'])
                    output.append(f'<line x1="{_fmt(marker["x"])}" y1="{_fmt(marker["y"])}" x2="{_fmt(marker["leaderX"])}" y2="{_fmt(marker["leaderY"])}" stroke={color} stroke-width="{_fmt(t["fontSize"]*.06)}"/>')
                    output.append(f'<circle cx="{_fmt(marker["x"])}" cy="{_fmt(marker["y"])}" r="{_fmt(marker["radius"])}" fill={color}/>')
                transform=(f' transform="rotate({_fmt(t["rotation"])} {_fmt(t["x"])} {_fmt(t["y"])})"' if 'rotation' in t else '')
                output.append(f'<text fill={quoteattr(t["color"])} font-family="sans-serif" font-size="{_fmt(t["fontSize"])}" xml:space="preserve"{transform}>')
                for index,line in enumerate(t['content'].replace('\r\n','\n').replace('\r','\n').split('\n')):
                    output.append(f'<tspan x="{_fmt(t["x"])}" y="{_fmt(t["y"]+t["fontSize"]*(1+index*1.2))}">{escape(line)}</tspan>')
                output.append('</text>')
        output.append('</g>')
    output.append('</svg>');return '\n'.join(output).encode('utf-8')


def _outline_export_text(doc):
    """Replace text only in the scoped export copy, keeping layer ownership."""
    if not doc['texts']:
        return 0
    from vector_text import outline_text
    converted = {}
    used_ids = {p['id'] for p in doc['paths']}
    count = 0
    for text in doc['texts']:
        if 'dimension' in text:
            from vector_dimension import dimension_segments
            line_paths=[]
            for index,(start,end) in enumerate(dimension_segments(text)):
                nodes=[]
                for point in (start,end):
                    nodes.append({'x':point['x'],'y':point['y'],
                                  'in':{'x':point['x'],'y':point['y']},
                                  'out':{'x':point['x'],'y':point['y']},'mode':'cusp'})
                line_paths.append({'id':f'{text["id"]}-dimension-{index}','name':text['name'],
                                   'color':text['color'],'role':'outline','closed':False,'nodes':nodes})
            label=copy.deepcopy(text);label.pop('dimension',None)
            paths=line_paths+outline_text(label)
        else:
            paths = outline_text(text)
        for path in paths:
            count += 1
            if count + len(doc['paths']) > 500:
                raise ValueError('文字转曲后超过 500 条曲线，请减少文字或分图层导出')
            candidate = f'export-text-{count}'
            while candidate in used_ids:
                candidate += '-'
            used_ids.add(candidate)
            path['id'] = candidate
        converted[text['id']] = paths
    by_id = {p['id']:p for p in doc['paths']}
    ordered_paths = []
    for layer in doc['layers']:
        items = []
        for item in layer['items']:
            paths = converted[item['id']] if item['type'] == 'text' else [by_id[item['id']]]
            for path in paths:
                ordered_paths.append(path)
                items.append({'type':'path','id':path['id']})
        layer['items'] = items
        layer['pathIds'] = [item['id'] for item in items]
        layer['textIds'] = []
    doc['paths'] = ordered_paths
    doc['texts'] = []
    doc['layers'] = [layer for layer in doc['layers'] if layer['items']]
    if not doc['paths']:
        raise ValueError('所选文字只有空白，没有可以导出的轮廓')
    return count


def export_document(document, file_format, layer_ids=None, dxf_mode='polyline'):
    if file_format not in ('ai','dxf','svg'):raise ValueError('不支持的导出格式')
    scale=millimeters_per_pixel(document)
    doc=scope_document(document,layer_ids)
    if doc['images']:raise ValueError('所选范围包含图片，请选择仅含矢量内容的图层后导出')
    text_outline_count = _outline_export_text(doc) if file_format in ('ai','dxf') else 0
    if any(len(p['nodes'])<2 for p in doc['paths']):raise ValueError('导出范围包含孤立节点，请补成线条或隐藏后重试')
    if file_format=='svg':data=_svg(doc,scale);mime='image/svg+xml'
    elif file_format=='ai':
        from vector_ai import export_ai
        data=export_ai(doc);mime='application/postscript'
    else:
        from vector_dxf import export_dxf
        data=export_dxf(doc, mode=dxf_mode);mime='application/dxf'
    x,y,w,h=content_bounds(doc)
    return {'data':data,'mime':mime,'widthMm':w*scale,'heightMm':h*scale,
            'textOutlineCount':text_outline_count}


def _export_statistics(raw, file_format, source):
    """Keep editable anchors distinct from coordinates used to encode curves."""
    stats = {'sourceNodeCount': sum(len(p['nodes']) for p in source['paths']),
             'curveCount': 0, 'curveNodeCount': 0, 'filePointCount': 0,
             'fileHandlePointCount': None if file_format == 'dxf' else 0,
             'polylineVertexCount': 0, 'splineControlPointCount': 0,
             'textCount': len(source['texts'])}
    if file_format == 'dxf':
        from vector_dxf import _pairs, _sections, _records, _spline_segments
        entities = _records(_sections(_pairs(raw))['ENTITIES'])
        for kind, fields in entities:
            count = sum(code == 10 for code, value in fields)
            if kind == 'LWPOLYLINE':
                stats['polylineVertexCount'] += count
                stats['curveNodeCount'] += count
            elif kind == 'SPLINE':
                # Decode the actual cubic spans, including closure, rather than
                # assuming exported anchors equal the original source count.
                segments, closed = _spline_segments(fields, (1, 0, 0, 1, 0, 0))
                stats['splineControlPointCount'] += count
                stats['curveNodeCount'] += len(segments) + (0 if closed else 1)
            else:
                raise ValueError('无法统计此 DXF 对象的导出节点')
            stats['curveCount'] += 1
            stats['filePointCount'] += count
    elif file_format == 'ai':
        from vector_ai import import_ai
        restored = import_ai(raw, 'export-preview.ai')['document']
        stats['curveCount'] = len(restored['paths'])
        stats['curveNodeCount'] = sum(len(p['nodes']) for p in restored['paths'])
        # These are the explicit m/L/C records emitted by export_ai; prolog,
        # layer names and other PostScript records are not coordinate points.
        for line in raw.decode('ascii').splitlines():
            tokens = line.split()
            if len(tokens) == 3 and tokens[-1] in ('m', 'L'):
                stats['filePointCount'] += 1
            elif len(tokens) == 7 and tokens[-1] == 'C':
                stats['filePointCount'] += 3
                stats['fileHandlePointCount'] += 2
    else:
        # _svg emits one M, explicit cubic C spans and optional Z per path.
        # Count the produced path records, never the source nodes or text marks.
        for path in ET.fromstring(raw).iter('{http://www.w3.org/2000/svg}path'):
            tokens = path.attrib['d'].split()
            spans = tokens.count('C')
            stats['curveCount'] += 1
            stats['curveNodeCount'] += 1 + spans - int(tokens[-1] == 'Z')
            stats['filePointCount'] += 1 + 3 * spans
            stats['fileHandlePointCount'] += 2 * spans
    # Keep already-open old pages functional until the user refreshes. New UI
    # uses curveNodeCount/filePointCount, never this former ambiguous field.
    stats['nodeCount'] = stats['filePointCount']
    return stats


def preview_export(document, file_format, layer_ids=None):
    """Preview actual exported curve anchors separately from file controls."""
    if file_format not in ('ai', 'dxf', 'svg'):
        raise ValueError('不支持的导出格式')
    source = scope_document(document, layer_ids)
    def statistics(result):
        stats = _export_statistics(result['data'], file_format, source)
        stats.update({key:result[key] for key in ('textOutlineCount','widthMm','heightMm')})
        return stats
    if file_format != 'dxf':
        result = export_document(document, file_format, layer_ids)
        return {'stats': statistics(result)}
    modes = {}
    for mode in ('spline', 'polyline'):
        try:
            result = export_document(document, file_format, layer_ids, dxf_mode=mode)
            modes[mode] = statistics(result)
        except ValueError as error:
            modes[mode] = {'error': str(error)}
    available = [mode for mode in modes if 'error' not in modes[mode]]
    if not available:
        raise ValueError(modes['spline']['error'])
    # Controls/handles are not extra curve nodes. Prefer preserved curves when
    # the actual exported anchor counts tie, regardless of control-point totals.
    recommended = min(available, key=lambda mode: modes[mode]['curveNodeCount'])
    return {'modes': modes, 'recommendedMode': recommended}
