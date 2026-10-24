"""HP-GL pattern import preserves plotted geometry and physical dimensions."""
import base64
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/curve-editor'))
import vector_io
import server

FIXTURE = Path(__file__).parent / 'fixtures/vector-plt/large-horn.plt'


def load(raw, name='pattern.plt'):
    if isinstance(raw, str):
        raw = raw.encode('ascii')
    return vector_io.import_file(name, base64.b64encode(raw).decode())


class PLTImportTests(unittest.TestCase):
    def test_relative_decimal_closure_and_pen_layer_limit(self):
        doc = load('IN;SP1;PA;PU.3,0;PD;PR.1,0,0,.1,-.1,-.1;')['document']
        self.assertTrue(doc['paths'][0]['closed'])
        self.assertEqual(len(doc['paths'][0]['nodes']), 3)
        many_pens = 'IN;' + ''.join(f'SP{pen};PU0,0;PD40,0;' for pen in range(1,202))
        with self.assertRaisesRegex(ValueError, '图层'):
            load(many_pens)

    def test_large_offsets_and_limits_match_editable_document_contract(self):
        doc = load('IN;SP1;PU2000000,0;PD2000040,0;')['document']
        server.validate(doc)
        self.assertEqual(doc['paths'][0]['nodes'][0]['x'], 50000)
        import vector_plt
        with patch.object(vector_plt, 'MAX_NODES', 3), self.assertRaisesRegex(ValueError, '节点'):
            load('IN;SP1;PD40,0,80,0,120,0;')
        with patch.object(vector_plt, 'MAX_PATHS', 1), self.assertRaisesRegex(ValueError, '曲线'):
            load('IN;SP1;PD40,0;PU80,0;PD120,0;')
        self.assertLessEqual(vector_plt.MAX_PATHS, 500)

    @unittest.skipUnless(FIXTURE.is_file(), 'local PLT fixture not supplied')
    def test_real_horn_closed_contour_and_dimensions(self):
        result = load(FIXTURE.read_bytes(), '大羊角.PLT')
        doc = result['document']
        server.validate(doc)
        self.assertEqual(doc['title'], '大羊角')
        self.assertEqual(len(doc['paths']), 1)
        path = doc['paths'][0]
        self.assertTrue(path['closed'])
        self.assertEqual(len(path['nodes']), 128)
        self.assertEqual(path['nodes'][0]['x'], 17461.4 / 40)
        self.assertEqual(path['nodes'][0]['y'], 42463.2 / 40)
        self.assertEqual(vector_io.millimeters_per_pixel(doc), 1)
        stats = vector_io.preview_export(doc, 'svg')['stats']
        self.assertAlmostEqual(stats['widthMm'], 189.6)
        self.assertAlmostEqual(stats['heightMm'], 98.135)
        for node in path['nodes']:
            self.assertEqual(node['in'], {'x': node['x'], 'y': node['y']})
            self.assertEqual(node['out'], node['in'])
        self.assertEqual(doc['originals'], doc['paths'])
        self.assertIsNot(doc['originals'][0], path)
        for fmt in ('ai', 'dxf'):
            raw = vector_io.export_document(doc, fmt)['data']
            restored = load(raw, 'roundtrip.' + fmt)['document']
            stats = vector_io.preview_export(restored, 'svg')['stats']
            self.assertAlmostEqual(stats['widthMm'], 189.6, places=4)
            self.assertAlmostEqual(stats['heightMm'], 98.135, places=4)

    def test_pen_up_moves_are_not_joined_and_pens_form_layers(self):
        doc = load('IN;SP1;PU0,0;PD400,0;PU800,0;PD800,400;SP2;PU0,0;PD0,400;SP0;')['document']
        self.assertEqual([len(p['nodes']) for p in doc['paths']], [2, 2, 2])
        self.assertEqual([len(l['pathIds']) for l in doc['layers']], [2, 1])
        self.assertTrue(all(not p['closed'] for p in doc['paths']))
        server.validate(doc)

    def test_relative_absolute_modes_and_omitted_semicolons(self):
        doc = load('in;sp1;pa;pu40,80pd;pr40,0,0,40;pa40,80;pu')['document']
        p = doc['paths'][0]
        self.assertTrue(p['closed'])
        self.assertEqual([(n['x'], n['y']) for n in p['nodes']], [(1,-2),(2,-2),(2,-3)])

    def test_initialize_resets_position_mode_and_keeps_existing_geometry(self):
        doc = load('IN;SP1;PR;PD40,0;IN;SP1;PD0,40;')['document']
        self.assertEqual(len(doc['paths']), 2)
        self.assertEqual([(n['x'], n['y']) for n in doc['paths'][1]['nodes']], [(0,0),(0,-1)])

    def test_unsupported_geometry_scaling_text_and_linestyle_fail_explicitly(self):
        for command in ('AA0,0,90;', 'CI40;', 'SC0,100,0,100;', 'IP0,0,400,400;',
                        'LBhello\x03;', 'LT2;', 'RO90;', 'XX;', 'PG;'):
            with self.subTest(command=command), self.assertRaisesRegex(ValueError, command[:2]):
                load('IN;SP1;PU0,0;PD40,40;' + command)

    def test_invalid_pairs_nonfinite_out_of_range_and_empty_geometry(self):
        for raw in ('IN;PD1;', 'IN;PD1,,2;', 'IN;PD1.2.3,4;', 'IN;PDnan,0;',
                    'IN;PD99999999999999,0;', 'IN;SP1;', 'IN;SP0;PD40,0;',
                    'IN;PD0,0;', 'IN;PD40,0;trailing garbage', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                load(raw)

    def test_repeated_closed_endpoint_removed_but_open_return_segment_preserved(self):
        doc = load('IN;SP1;PU0,0;PD40,0,40,40,0,0;PU;PD40,0,0,0;')['document']
        self.assertEqual([p['closed'] for p in doc['paths']], [True, False])
        self.assertEqual([len(p['nodes']) for p in doc['paths']], [3, 3])


if __name__ == '__main__':
    unittest.main()
