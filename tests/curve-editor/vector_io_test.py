"""Layer selection and physical export contracts, independent of browser state."""
import copy
import math
import sys
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/curve-editor'))
import vector_io


def curve(id, x=0):
    return {'id':id,'name':id,'color':'#123456','role':'outline','closed':True,'nodes':[{'x':a,'y':b,'in':{'x':a,'y':b},'out':{'x':a,'y':b},'mode':'cusp'} for a,b in [(x,0),(x+72,0),(x+72,36),(x,36)]]}


def sample():
    paths=[curve('one'),curve('two',100),curve('three',200),curve('four',300)]
    return {'format':'daban-curve-editor','version':1,'units':'image-px','title':'尺寸测试','width':500,'height':400,'paths':paths,'images':[],'texts':[],'originals':[],
        'calibration':{'a':{'x':0,'y':0},'b':{'x':72,'y':0},'length':25.4,'unit':'mm'},
        'layers':[{'id':'group','kind':'group','name':'组','visible':True,'locked':False,'pathIds':[],'imageIds':[],'textIds':[]},
            {'id':'a','parentId':'group','name':'第一层','visible':True,'locked':True,'pathIds':['one'],'imageIds':[],'textIds':[]},
            {'id':'b','parentId':'group','name':'隐藏层','visible':False,'locked':False,'pathIds':['two'],'imageIds':[],'textIds':[]},
            {'id':'c','name':'外层','visible':True,'locked':False,'pathIds':['three','four'],'imageIds':[],'textIds':[],'items':[{'type':'path','id':'three'},{'type':'path','id':'four','visible':False}]}]}


def sixteen_node_sample():
    doc=sample();p=doc['paths'][0];p['nodes']=[]
    radius=50;handle=4/3*math.tan(math.pi/32)*radius
    for i in range(16):
        angle=2*math.pi*i/16;x=radius*math.cos(angle);y=radius*math.sin(angle)
        tx=-math.sin(angle)*handle;ty=math.cos(angle)*handle
        p['nodes'].append({'x':x,'y':y,'in':{'x':x-tx,'y':y-ty},'out':{'x':x+tx,'y':y+ty},'mode':'smooth'})
    doc['calibration']['length']=72
    return doc


class VectorIOTests(unittest.TestCase):
    def test_dxf_preview_counts_serialized_points_and_prefers_smaller_output(self):
        doc=sample();p=doc['paths'][0];p['closed']=False;p['nodes']=p['nodes'][:2]
        p['nodes'][0]['out']={'x':24,'y':0};p['nodes'][1]['in']={'x':48,'y':0}
        before=copy.deepcopy(doc)
        preview=vector_io.preview_export(doc,'dxf',['a'])
        self.assertEqual(preview['recommendedMode'],'spline')  # two anchors in both; handles do not break the tie
        for mode,points in [('spline',4),('polyline',2)]:
            self.assertEqual(preview['modes'][mode]['curveNodeCount'],2)
            self.assertEqual(preview['modes'][mode]['sourceNodeCount'],2)
            self.assertEqual(preview['modes'][mode]['filePointCount'],points)
        self.assertEqual(doc,before)
        p['nodes'][0]['out']['y']=72;p['nodes'][1]['in']['y']=72
        preview=vector_io.preview_export(doc,'dxf',['a'])
        self.assertEqual(preview['recommendedMode'],'spline')
        for mode,stats in preview['modes'].items():
            # Count actual point coordinate records, independently of the preview parser.
            lines=vector_io.export_document(doc,'dxf',['a'],dxf_mode=mode)['data'].decode().splitlines()
            pairs=list(zip(lines[::2],lines[1::2]));entities=pairs[pairs.index(('2','ENTITIES'))+1:]
            self.assertEqual(stats['nodeCount'],sum(code=='10' for code,value in entities))
        self.assertGreater(preview['modes']['polyline']['nodeCount'],4)

    def test_dxf_preview_normalizes_closed_duplicates_and_respects_scope(self):
        doc=sample();doc['paths'][0]['nodes'].append(copy.deepcopy(doc['paths'][0]['nodes'][0]))
        scoped=vector_io.preview_export(doc,'dxf',['group'])
        self.assertEqual(scoped['recommendedMode'],'spline')
        self.assertEqual(scoped['modes']['spline']['nodeCount'],4)
        self.assertEqual(scoped['modes']['polyline']['nodeCount'],4)
        self.assertEqual(scoped['modes']['spline']['sourceNodeCount'],5)
        self.assertEqual(scoped['modes']['spline']['curveNodeCount'],4)
        all_visible=vector_io.preview_export(doc,'dxf')
        self.assertEqual(all_visible['modes']['spline']['curveCount'],2)
        self.assertEqual(all_visible['modes']['spline']['nodeCount'],8)

    def test_dxf_preview_keeps_available_mode_and_rejects_invalid_scope(self):
        doc=sample();p=doc['paths'][0];p['closed']=False;p['nodes']=p['nodes'][:2]
        p['nodes'][0]['out']={'x':0,'y':72};p['nodes'][1]['in']={'x':72,'y':72}
        with patch('vector_dxf.MAX_NODES',5):
            preview=vector_io.preview_export(doc,'dxf',['a'])
        self.assertEqual(preview['recommendedMode'],'spline')
        self.assertIn('error',preview['modes']['polyline'])
        self.assertEqual(preview['modes']['spline']['nodeCount'],4)
        with self.assertRaises(ValueError):vector_io.preview_export(doc,'dxf',[])
        with self.assertRaises(ValueError):vector_io.preview_export(doc,'pdf')

    def test_sixteen_curve_nodes_are_distinct_from_file_controls_in_all_formats(self):
        import vector_ai,vector_dxf
        doc=sixteen_node_sample();before=copy.deepcopy(doc)
        for fmt in ('ai','svg','dxf'):
            preview=vector_io.preview_export(doc,fmt,['a'])
            stats=preview['modes']['spline'] if fmt=='dxf' else preview['stats']
            self.assertEqual(stats['curveCount'],1)
            self.assertEqual(stats['sourceNodeCount'],16)
            self.assertEqual(stats['curveNodeCount'],16)
            self.assertEqual(stats['filePointCount'],49)
            self.assertEqual(stats['fileHandlePointCount'],None if fmt=='dxf' else 32)
            raw=vector_io.export_document(doc,fmt,['a'],dxf_mode='spline')['data']
            if fmt in ('ai','dxf'):
                importer=vector_ai.import_ai if fmt=='ai' else vector_dxf.import_dxf
                restored=importer(raw,'circle.'+fmt)['document']['paths'][0]
                self.assertEqual(len(restored['nodes']),stats['curveNodeCount'])
                # AI translates to the origin; compare every anchor and handle with one common translation.
                dx=restored['nodes'][0]['x']-doc['paths'][0]['nodes'][0]['x']
                dy=restored['nodes'][0]['y']-doc['paths'][0]['nodes'][0]['y']
                for a,b in zip(doc['paths'][0]['nodes'],restored['nodes']):
                    for p,q in [(a,b),(a['in'],b['in']),(a['out'],b['out'])]:
                        self.assertAlmostEqual(p['x']+dx,q['x'],places=7)
                        self.assertAlmostEqual(p['y']+dy,q['y'],places=7)
            else:
                path=ET.fromstring(raw).find('.//{http://www.w3.org/2000/svg}path')
                self.assertEqual(path.attrib['d'].split().count('C'),16)
        self.assertEqual(doc,before)

    def test_svg_preview_keeps_text_separate_from_curve_nodes(self):
        doc=sample();doc['texts']=[{'id':'label','name':'文字','x':0,'y':0,'content':'中文','fontSize':12,'color':'#000000'}];doc['layers'][1]['textIds']=['label']
        stats=vector_io.preview_export(doc,'svg',['a'])['stats']
        self.assertEqual(stats['curveNodeCount'],4)
        self.assertEqual(stats['textCount'],1)
        stats=vector_io.preview_export(doc,'ai',['a'])['stats']
        self.assertEqual(stats['textCount'],1)
        self.assertGreater(stats['textOutlineCount'],0)
        self.assertGreater(stats['curveNodeCount'],4)

    def test_dxf_mode_preserves_selected_curve_and_default_remains_polyline(self):
        import vector_dxf
        doc=sample();doc['paths'][0]['nodes'][0]['out']={'x':0,'y':-36}
        before=copy.deepcopy(doc)
        for mode,kind in [('spline','SPLINE'),('polyline','LWPOLYLINE')]:
            result=vector_io.export_document(doc,'dxf',['group'],dxf_mode=mode)
            entities=vector_dxf._records(vector_dxf._sections(vector_dxf._pairs(result['data']))['ENTITIES'])
            self.assertEqual([entity[0] for entity in entities],[kind])
            self.assertAlmostEqual(result['widthMm'],25.4)
            if mode=='spline':
                path=vector_dxf.import_dxf(result['data'],'selected.dxf')['document']['paths'][0]
                self.assertEqual(len(path['nodes']),4)
                self.assertAlmostEqual(path['nodes'][0]['out']['y'],-12.7)
        self.assertEqual(vector_io.export_document(doc,'dxf',['group'])['data'],
                         vector_io.export_document(doc,'dxf',['group'],dxf_mode='polyline')['data'])
        with self.assertRaises(ValueError):vector_io.export_document(doc,'dxf',['group'],dxf_mode='bad')
        self.assertEqual(doc,before)

    def test_selected_group_respects_visibility_and_includes_locked_curves(self):
        doc=sample();before=copy.deepcopy(doc)
        result=vector_io.scope_document(doc,['group'])
        self.assertEqual([p['id'] for p in result['paths']],['one'])
        self.assertEqual([l['name'] for l in result['layers']],['组 / 第一层'])
        self.assertEqual(doc,before)
        self.assertNotIn('parentId',result['layers'][0])

    def test_all_visible_excludes_hidden_items_and_hidden_ancestors(self):
        doc=sample()
        self.assertEqual([p['id'] for p in vector_io.scope_document(doc)['paths']],['one','three'])
        doc['layers'][0]['visible']=False
        self.assertEqual([p['id'] for p in vector_io.scope_document(doc)['paths']],['three'])

    def test_empty_unknown_and_invalid_layer_choices_fail(self):
        for ids in [[],['missing'],'a',[1]]:
            with self.subTest(ids=ids),self.assertRaises(ValueError):vector_io.scope_document(sample(),ids)
        with self.assertRaisesRegex(ValueError,'可见'):vector_io.scope_document(sample(),['b'])

    def test_svg_has_mm_dimensions_and_only_selected_geometry(self):
        result=vector_io.export_document(sample(),'svg',['a'])
        root=ET.fromstring(result['data'])
        self.assertAlmostEqual(float(root.attrib['width'][:-2]),25.4,places=8)
        self.assertAlmostEqual(float(root.attrib['height'][:-2]),12.7,places=8)
        self.assertTrue(root.attrib['width'].endswith('mm'))
        self.assertEqual(len(root.findall('.//{http://www.w3.org/2000/svg}path')),1)
        self.assertIn('第一层',result['data'].decode())

    def test_svg_bounds_follow_bezier_extrema_without_page_padding(self):
        doc=sample();p=doc['paths'][0];p['closed']=False;p['nodes']=p['nodes'][:2]
        p['nodes'][0]['out']={'x':0,'y':72};p['nodes'][1]['in']={'x':72,'y':72}
        result=vector_io.export_document(doc,'svg',['a']);root=ET.fromstring(result['data'])
        self.assertAlmostEqual(float(root.attrib['height'][:-2]),19.05,places=8)

    def test_unknown_scale_cannot_be_dimensioned(self):
        doc=sample();doc['calibration']=None
        for fmt in ['svg','ai','dxf']:
            with self.subTest(fmt=fmt),self.assertRaisesRegex(ValueError,'比例|标定'):vector_io.export_document(doc,fmt,['a'])

    def test_nonfinite_and_zero_scale_fail(self):
        for length in [float('nan'),float('inf'),0,-1]:
            doc=sample();doc['calibration']['length']=length
            with self.assertRaises(ValueError):vector_io.export_document(doc,'svg',['a'])

    def test_vector_export_outlines_text_and_rejects_images_without_silent_loss(self):
        doc=sample();doc['texts']=[{'id':'label','name':'文字','x':0,'y':0,'content':'中文','fontSize':12,'color':'#000000'}];doc['layers'][1]['textIds']=['label']
        before=copy.deepcopy(doc)
        for fmt in ['ai','dxf']:
            with self.subTest(fmt=fmt):
                result=vector_io.export_document(doc,fmt,['a'])
                self.assertGreater(result['textOutlineCount'],0)
                stats=vector_io.preview_export(doc,fmt,['a'])
                stats=stats['modes']['spline'] if fmt=='dxf' else stats['stats']
                self.assertEqual(stats['textCount'],1)
                self.assertEqual(stats['sourceNodeCount'],4)
                self.assertGreater(stats['curveCount'],1)
        self.assertEqual(doc,before)
        self.assertIn('中文',vector_io.export_document(doc,'svg',['a'])['data'].decode())
        doc['images']=[{'id':'img'}];doc['layers'][1]['imageIds']=['img']
        for fmt in ['ai','dxf','svg']:
            with self.assertRaisesRegex(ValueError,'图片'):vector_io.export_document(doc,fmt,['a'])

    def test_outlined_text_multiple_layers_roundtrip_size_rotation_and_scope(self):
        import vector_ai,vector_dxf
        doc=sample();doc['calibration']['length']=36
        doc['texts']=[
            {'id':'label','name':'裁片标记','x':400,'y':120,'content':'羊 A08\n左片','fontSize':12,'rotation':35,'color':'#123456'},
            {'id':'secret','name':'隐藏','x':-999,'y':-999,'content':'不导出','fontSize':12,'color':'#000000'}]
        doc['layers'].append({'id':'text-layer','name':'标注','visible':True,'locked':True,'pathIds':[],'imageIds':[],'textIds':['label']})
        doc['layers'][2]['textIds']=['secret']
        before=copy.deepcopy(doc)
        for fmt in ['ai','dxf']:
            for mode in (['spline','polyline'] if fmt=='dxf' else ['spline']):
                result=vector_io.export_document(doc,fmt,['a','text-layer'],dxf_mode=mode)
                importer=vector_ai.import_ai if fmt=='ai' else vector_dxf.import_dxf
                restored=importer(result['data'],'text.'+fmt)['document']
                self.assertEqual(len(restored['layers']),2)
                self.assertTrue(any('标注' in l['name'] for l in restored['layers']))
                self.assertEqual(restored['texts'],[])
                self.assertGreater(len(restored['paths']),2)
                self.assertLess(result['widthMm'],250)
                self.assertGreater(result['widthMm'],200)
                _,_,width,height=vector_io.content_bounds(restored)
                self.assertAlmostEqual(width,result['widthMm'],delta=.011)
                self.assertAlmostEqual(height,result['heightMm'],delta=.011)
                text_only=vector_io.export_document(doc,fmt,['text-layer'],dxf_mode=mode)
                self.assertGreater(text_only['widthMm'],0)
                self.assertLess(text_only['widthMm'],50)
        self.assertEqual(doc,before)

    def test_blank_text_and_generated_id_collision_are_handled_without_mutation(self):
        import vector_ai
        doc=sample()
        doc['paths'][0]['id']='export-text-1';doc['layers'][1]['pathIds']=['export-text-1']
        doc['texts']=[{'id':'label','name':'文字','x':10,'y':30,'content':'I','fontSize':12,'color':'#000000'}]
        doc['layers'].append({'id':'text','name':'文字','visible':True,'pathIds':[],'imageIds':[],'textIds':['label']})
        before=copy.deepcopy(doc)
        result=vector_io.export_document(doc,'ai',['a','text'])
        restored=vector_ai.import_ai(result['data'],'text.ai')['document']
        self.assertEqual(len(restored['paths']),2)
        self.assertEqual(doc,before)
        doc['texts'][0]['content']='  \n '
        for fmt in ['ai','dxf']:
            with self.assertRaisesRegex(ValueError,'空白'):vector_io.export_document(doc,fmt,['text'])
            result=vector_io.export_document(doc,fmt,['a','text'])
            self.assertEqual(result['textOutlineCount'],0)

    def test_svg_rotates_text_around_top_left_anchor_and_uses_rotated_extent(self):
        doc=sample();doc['paths']=[];doc['layers'][1]['pathIds']=[];doc['calibration']['length']=72
        doc['texts']=[{'id':'label','name':'文字','x':10,'y':20,'content':'AB','fontSize':10,'color':'#000000','rotation':90}];doc['layers'][1]['textIds']=['label']
        result=vector_io.export_document(doc,'svg',['a']);root=ET.fromstring(result['data'])
        text=root.find('.//{http://www.w3.org/2000/svg}text')
        self.assertEqual(root.attrib['viewBox'],'-2 20 12 24')
        self.assertEqual(root.attrib['width'],'12mm');self.assertEqual(root.attrib['height'],'24mm')
        self.assertEqual(text.attrib['transform'],'rotate(90 10 20)')
        self.assertAlmostEqual(result['widthMm'],12);self.assertAlmostEqual(result['heightMm'],24)

    def test_invalid_import_encoding_and_extension_fail(self):
        with self.assertRaises(ValueError):vector_io.import_file('file.exe','YWJj')
        with self.assertRaises(ValueError):vector_io.import_file('file.ai','not base64!')


if __name__=='__main__':unittest.main()
