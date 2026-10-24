"""AI geometry codec: run directly with Python, no installed packages required."""
import io
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/curve-editor'))
from vector_ai import import_ai, export_ai


def ai(body):
    return ('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator\n%%EndComments\n%%EndSetup\n' + body + '\n%%Trailer\n%%EOF\n').encode('ascii')


class AICodecTests(unittest.TestCase):
    def test_units_orientation_and_cubic_closure(self):
        d = import_ai(ai('0 0 m\n24 0 48 72 72 72 C\n0 72 L\ns'), 'test.ai')['document']
        self.assertEqual(d['calibration']['length'], 1)
        p = d['paths'][0]
        self.assertTrue(p['closed'])
        self.assertAlmostEqual(p['nodes'][1]['x'] - p['nodes'][0]['x'], 25.4)
        self.assertAlmostEqual(p['nodes'][0]['y'] - p['nodes'][1]['y'], 25.4)
        self.assertAlmostEqual(p['nodes'][0]['out']['x'] - p['nodes'][0]['x'], 25.4 / 3)

    def test_layers_colors_and_roundtrip(self):
        d = import_ai(ai('1 1 1 1 0 0 0 0 0 0 Lb\n(outer) Ln\n1 0 0 RG\n0 0 m\n72 0 L\n72 72 L\ns\nLB\n1 1 1 1 0 0 0 0 0 0 Lb\n(inner) Ln\n0 0 m\n20 10 50 40 72 72 C\nS\nLB'), 'layers.ai')['document']
        d['layers'][0]['name'] = '外轮廓（羊）'
        result = export_ai(d)
        self.assertTrue(result.startswith(b'%!PS-Adobe-3.0'))
        self.assertIn(b'%%BoundingBox:', result)
        e = import_ai(result, 'roundtrip.ai')['document']
        self.assertEqual([l['name'] for l in e['layers']], ['外轮廓（羊）', 'inner'])
        self.assertEqual([p['closed'] for p in e['paths']], [True, False])
        self.assertEqual(e['paths'][0]['color'], '#ff0000')
        for p, q in zip(d['paths'], e['paths']):
            for a, b in zip(p['nodes'], q['nodes']):
                for key in ['x', 'y']:
                    self.assertAlmostEqual(a[key], b[key], places=7)
                    for side in ['in', 'out']:
                        self.assertAlmostEqual(a[side][key], b[side][key], places=7)

    def test_cm_calibration(self):
        d = import_ai(ai('0 0 m 72 0 L S'), 'x.ai')['document']
        d['calibration']['length'] = 2
        d['calibration']['unit'] = 'cm'
        e = import_ai(export_ai(d), 'x.ai')['document']
        self.assertAlmostEqual(e['paths'][0]['nodes'][1]['x'], 25.4 * 20, places=6)

    def test_legacy_transform(self):
        d = import_ai(ai('gsave [2 0 0 3 10 20] concat\n0 0 m 72 72 L S\ngrestore'), 'x.ai')['document']
        self.assertAlmostEqual(d['paths'][0]['nodes'][1]['x'], 50.8)
        self.assertAlmostEqual(d['paths'][0]['nodes'][0]['y'], 76.2)

    def test_reject_non_geometry_and_malformed(self):
        for body in ['0 0 m 1 1 L F', '0 0 m 1 1 L W S', '(hello) show', 'image', '1 2 L S', '0 0 m 1 1 L', '0 0 m 1 1 L unknown S', 'grestore', '0 0 m 1e999 1 L S']:
            with self.subTest(body=body), self.assertRaises(ValueError):
                import_ai(ai(body), 'bad.ai')
        for data in [b'not ai', b'%!PS-Adobe-3.0\n{loop} loop', b'']:
            with self.assertRaises(ValueError):
                import_ai(data, 'bad.ai')

    def test_export_requires_scale_and_rejects_text(self):
        d = import_ai(ai('0 0 m 72 0 L S'), 'x.ai')['document']
        c = d.pop('calibration')
        with self.assertRaises(ValueError):
            export_ai(d)
        d['calibration'] = c
        d['texts'] = [{'content': 'hello'}]
        with self.assertRaises(ValueError):
            export_ai(d)


    def test_closed_cubic_roundtrip_has_no_duplicate_node(self):
        d = import_ai(ai('0 0 m 72 0 L 72 72 L s'), 'x.ai')['document']
        p = d['paths'][0]
        p['nodes'][-1]['out'] = {'x': 15, 'y': 15}
        p['nodes'][0]['in'] = {'x': 3, 'y': 20}
        e = import_ai(export_ai(d), 'x.ai')['document']
        self.assertEqual(len(e['paths'][0]['nodes']), 3)
        self.assertAlmostEqual(e['paths'][0]['nodes'][0]['in']['x'], 3, places=7)

    def pdf(self, content, **entries):
        sys.path.insert(0, str(ROOT / 'tools/curve-editor/vendor/python'))
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, NameObject, NumberObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=200, height=200)
        stream = DecodedStreamObject()
        stream.set_data(content)
        page[NameObject('/Contents')] = writer._add_object(stream)
        for key, value in entries.items():
            page[NameObject('/' + key)] = NumberObject(value)
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()

    def test_pdf_paths_transforms_userunits(self):
        d = import_ai(self.pdf(b'q 2 0 0 3 10 20 cm 0 0 m 72 72 l S Q', UserUnit=2), 'pdf.ai')['document']
        self.assertAlmostEqual(d['paths'][0]['nodes'][1]['x'], 101.6)
        self.assertAlmostEqual(d['paths'][0]['nodes'][0]['y'], 152.4)
        d = import_ai(self.pdf(b'0 0 72 72 re S'), 'rect.ai')['document']
        self.assertEqual(len(d['paths'][0]['nodes']), 4)
        self.assertTrue(d['paths'][0]['closed'])

    def test_pdf_rejects_complex_constructs(self):
        for content in [b'0 0 72 72 re f', b'0 0 72 72 re W n', b'BT (hello) Tj ET', b'/Form1 Do', b'/GS1 gs', b'0 0 m 10 10 l n', b'[' * 33 + b']' * 33]:
            with self.subTest(content=content), self.assertRaises(ValueError):
                import_ai(self.pdf(content), 'complex.ai')


    def packed_pdf(self, object_padding=0, xref_padding=0, content_padding=0):
        """A real PDF 1.5 xref stream plus compressed catalog/page tree."""
        import zlib
        objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
                   b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
                   b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>']
        header = b''
        body = b''
        for i, obj in enumerate(objects, 1):
            header += ('%d %d ' % (i, len(body))).encode()
            body += obj + b' '
        packed = zlib.compress(header + body + b' ' * object_padding)
        contents = zlib.compress(b'0 0 m 72 72 l S' + b' ' * content_padding)
        data = bytearray(b'%PDF-1.5\n')
        offsets = {}
        def append(number, raw):
            offsets[number] = len(data)
            data.extend(('%d 0 obj\n' % number).encode() + raw + b'\nendobj\n')
        append(4, ('<< /Type /ObjStm /N 3 /First %d /Filter /FlateDecode /Length %d >>\nstream\n' % (len(header), len(packed))).encode() + packed + b'\nendstream')
        append(5, ('<< /Filter /FlateDecode /Length %d >>\nstream\n' % len(contents)).encode() + contents + b'\nendstream')
        offsets[6] = len(data)
        records = bytearray()
        for i in range(7):
            if i == 0: typ, a, b = 0, 0, 65535
            elif i <= 3: typ, a, b = 2, 4, i-1
            else: typ, a, b = 1, offsets[i], 0
            records.extend(bytes([typ]) + a.to_bytes(4,'big') + b.to_bytes(2,'big'))
        packed_xref = zlib.compress(bytes(records) + b' ' * xref_padding)
        append(6, ('<< /Type /XRef /Size 7 /Root 1 0 R /W [1 4 2] /Filter /FlateDecode /Length %d >>\nstream\n' % len(packed_xref)).encode() + packed_xref + b'\nendstream')
        data.extend(('startxref\n%d\n%%%%EOF\n' % offsets[6]).encode())
        return bytes(data)

    def test_pdf_packed_structural_streams_budget(self):
        import vector_ai
        from unittest.mock import patch
        # A normal packed PDF remains supported.
        self.assertEqual(len(import_ai(self.packed_pdf(), 'packed.ai')['document']['paths']), 1)
        for kwargs in [dict(object_padding=2_000_000), dict(xref_padding=2_000_000),
                       dict(object_padding=2300, content_padding=2300)]:
            data = self.packed_pdf(**kwargs)
            self.assertLess(len(data), 4096)
            with self.subTest(kwargs=kwargs), patch.object(vector_ai, 'MAX_BYTES', 4096):
                with self.assertRaisesRegex(ValueError, '上限'):
                    import_ai(data, 'packed.ai')

    def test_decode_bomb_bound(self):
        import zlib
        import vector_ai
        sys.path.insert(0, str(ROOT / 'tools/curve-editor/vendor/python'))
        from pypdf.generic import EncodedStreamObject, NameObject
        stream = EncodedStreamObject()
        stream._data = zlib.compress(b'x' * 10000)
        stream[NameObject('/Filter')] = NameObject('/FlateDecode')
        old = vector_ai.MAX_BYTES
        vector_ai.MAX_BYTES = 1000
        try:
            with self.assertRaises(ValueError): vector_ai._stream_data(stream)
            # ASCII85 z expands to four bytes; enforce the budget before its
            # decoder allocates the expanded result.
            stream._data = b'z' * 400
            stream[NameObject('/Filter')] = NameObject('/ASCII85Decode')
            with self.assertRaises(ValueError): vector_ai._stream_data(stream)
        finally:
            vector_ai.MAX_BYTES = old

    def test_path_limit(self):
        with self.assertRaises(ValueError):
            import_ai(ai('0 0 m\n' + '1 1 L\n' * 10000 + 'S'), 'large.ai')

    @unittest.skipUnless((ROOT / 'tmp/1  2  号羊.ai').exists(), 'optional local real-world AI sample')
    def test_real_coreldraw_private_ai(self):
        result = import_ai((ROOT / 'tmp/1  2  号羊.ai').read_bytes(), '羊.ai')
        d = result['document']
        self.assertEqual(len(d['paths']), 56)
        self.assertEqual(sum(len(p['nodes']) for p in d['paths']), 19153)
        self.assertEqual(sum(p['closed'] for p in d['paths']), 54)
        self.assertEqual(result['sourceUnit'], 'pt')


if __name__ == '__main__':
    unittest.main()
