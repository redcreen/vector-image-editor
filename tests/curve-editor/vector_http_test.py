"""Exercise same-origin vector exchange without touching user workspaces."""
import json
import base64
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import server_test
SAMPLE = server_test.SAMPLE

class VectorHTTPTests(unittest.TestCase):
    setUp=server_test.ProjectIsolationTests.setUp
    tearDown=server_test.ProjectIsolationTests.tearDown
    start=server_test.ProjectIsolationTests.start
    read=server_test.ProjectIsolationTests.read
    def post(self,url,path,payload,origin=None):
        req=Request(url+path,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':url if origin is None else origin})
        return urlopen(req,timeout=8)
    def calibrated(self):
        doc=json.loads(json.dumps(SAMPLE));doc['calibration']={'a':{'x':0,'y':0},'b':{'x':72,'y':0},'length':25.4,'unit':'mm'}
        return doc
    def test_plt_import_is_calibrated_validated_and_does_not_save(self):
        project=self.base/'plt';project.mkdir();_,url=self.start(project)
        raw=b'IN;SP1;PU0,0;PD400,0,400,200,0,0;SP0;'
        with self.post(url,'/api/vector/import',{'name':'horn.PLT','data':base64.b64encode(raw).decode()}) as response:
            doc=json.load(response)['document']
        self.assertEqual(len(doc['paths'][0]['nodes']),3)
        self.assertTrue(doc['paths'][0]['closed'])
        self.assertEqual(doc['paths'][0]['nodes'][2]['y'],-5)
        self.assertEqual(doc['calibration']['length'],1)
        with self.assertRaises(HTTPError) as caught:
            self.post(url,'/api/vector/import',{'name':'bad.plt','data':base64.b64encode(raw+b'AA0,0,90;').decode()})
        self.assertEqual(caught.exception.code,400)
        self.assertIn('AA',json.load(caught.exception)['error']);caught.exception.close()
        self.assertIsNone(self.read(url,'/api/latest'))
    def test_preview_matches_actual_downloads_without_saving(self):
        project=self.base/'preview';project.mkdir();_,url=self.start(project)
        payload={'document':self.calibrated(),'format':'dxf'}
        with self.post(url,'/api/vector/preview',payload) as response:preview=json.load(response)
        for mode,stats in preview['modes'].items():
            with self.post(url,'/api/vector/export',{**payload,'dxfMode':mode}) as response:
                lines=response.read().decode().splitlines()
            pairs=list(zip(lines[::2],lines[1::2]));entities=pairs[pairs.index(('2','ENTITIES'))+1:]
            self.assertEqual(stats['nodeCount'],sum(code=='10' for code,value in entities))
            self.assertEqual(stats['curveCount'],sum(code=='0' and value in ('SPLINE','LWPOLYLINE') for code,value in entities))
        counts={mode:stats['curveNodeCount'] for mode,stats in preview['modes'].items()}
        self.assertEqual(counts[preview['recommendedMode']],min(counts.values()))
        for fmt in ('ai','svg'):
            with self.post(url,'/api/vector/preview',{**payload,'format':fmt}) as response:stats=json.load(response)['stats']
            self.assertEqual(stats['sourceNodeCount'],sum(len(p['nodes']) for p in payload['document']['paths']))
            self.assertEqual(stats['curveNodeCount'],stats['sourceNodeCount'])
            self.assertGreaterEqual(stats['filePointCount'],stats['curveNodeCount'])
        with self.assertRaises(HTTPError) as caught:
            self.post(url,'/api/vector/preview',{'document':SAMPLE,'format':'dxf'})
        self.assertEqual(caught.exception.code,400);caught.exception.close()
        self.assertIsNone(self.read(url,'/api/latest'))
    def test_dxf_mode_reaches_codec_roundtrips_and_does_not_save(self):
        project=self.base/'spline';project.mkdir();_,url=self.start(project)
        doc=self.calibrated()
        for mode,entity in [('spline',b'\nSPLINE\n'),('polyline',b'\nLWPOLYLINE\n')]:
            with self.post(url,'/api/vector/export',{'document':doc,'format':'dxf','dxfMode':mode}) as response:
                raw=response.read();self.assertIn(entity,raw)
                self.assertIn('dxf',response.headers['Content-Type'])
            if mode=='spline':
                with self.post(url,'/api/vector/import',{'name':'spline.dxf','data':base64.b64encode(raw).decode()}) as response:
                    restored=json.load(response)['document']
                self.assertEqual(len(restored['paths']),len(doc['paths']))
                self.assertEqual([len(p['nodes']) for p in restored['paths']],[len(p['nodes']) for p in doc['paths']])
        for mode in ['bad',None,False,[]]:
            with self.assertRaises(HTTPError) as caught:
                self.post(url,'/api/vector/export',{'document':doc,'format':'dxf','dxfMode':mode})
            self.assertEqual(caught.exception.code,400);caught.exception.close()
        self.assertIsNone(self.read(url,'/api/latest'))
    def test_svg_endpoint_is_dimensioned_and_does_not_save(self):
        project=self.base/'vectors';project.mkdir();_,url=self.start(project)
        with self.post(url,'/api/vector/export',{'document':self.calibrated(),'format':'svg'}) as response:
            text=response.read().decode();self.assertEqual(response.status,200);self.assertIn('mm"',text);self.assertIn('svg',response.headers['Content-Type'])
        self.assertIsNone(self.read(url,'/api/latest'))
    def test_chinese_text_exports_previews_and_roundtrips_without_saving(self):
        project=self.base/'text';project.mkdir();_,url=self.start(project)
        doc=self.calibrated()
        doc['images']=[]
        doc['texts']=[{'id':'text-1','name':'名称','content':'羊 A08\n左片','x':50,'y':60,'fontSize':12,'rotation':30,'color':'#123456'}]
        doc['layers']=[{'id':'text-layer','name':'文字','visible':True,'locked':False,'pathIds':[p['id'] for p in doc['paths']],'imageIds':[],'textIds':['text-1']}]
        for fmt in ('ai','dxf'):
            payload={'document':doc,'format':fmt,'layerIds':['text-layer']}
            with self.post(url,'/api/vector/preview',payload) as response:preview=json.load(response)
            stats=preview['modes']['spline'] if fmt=='dxf' else preview['stats']
            self.assertEqual(stats['textCount'],1)
            self.assertGreater(stats['textOutlineCount'],0)
            with self.post(url,'/api/vector/export',{**payload,'dxfMode':'spline'}) as response:
                raw=response.read();self.assertEqual(response.status,200)
            with self.post(url,'/api/vector/import',{'name':'text.'+fmt,'data':base64.b64encode(raw).decode()}) as response:
                restored=json.load(response)['document']
            self.assertEqual(len(restored['paths']),stats['curveCount'])
            self.assertEqual(restored['texts'],[])
        self.assertIsNone(self.read(url,'/api/latest'))
    def test_export_requires_scale_and_import_rejects_invalid_data(self):
        project=self.base/'errors';project.mkdir();_,url=self.start(project)
        for path,payload in [('/api/vector/export',{'document':SAMPLE,'format':'svg'}),('/api/vector/import',{'name':'bad.ai','data':'!!!!'})]:
            with self.assertRaises(HTTPError) as caught:self.post(url,path,payload)
            self.assertEqual(caught.exception.code,400)
            caught.exception.close()
        self.assertIsNone(self.read(url,'/api/latest'))
    def test_foreign_origin_cannot_convert_or_export(self):
        project=self.base/'origin';project.mkdir();_,url=self.start(project)
        for path in ['/api/vector/import','/api/vector/export','/api/vector/preview']:
            with self.assertRaises(HTTPError) as caught:self.post(url,path,{},origin='https://example.com')
            self.assertEqual(caught.exception.code,403)
            caught.exception.close()
    def test_unitless_dxf_reports_unit_choice_then_imports(self):
        project=self.base/'units';project.mkdir();_,url=self.start(project)
        dxf='0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n25\n21\n10\n0\nENDSEC\n0\nEOF\n'
        payload={'name':'units.dxf','data':base64.b64encode(dxf.encode()).decode()}
        with self.assertRaises(HTTPError) as caught:self.post(url,'/api/vector/import',payload)
        self.assertEqual(caught.exception.code,400);self.assertTrue(json.load(caught.exception)['needsUnit'])
        caught.exception.close()
        with self.post(url,'/api/vector/import',{**payload,'unit':'mm'}) as response:result=json.load(response)
        self.assertEqual(len(result['document']['paths']),1);self.assertIsNotNone(result['document']['calibration'])

if __name__=='__main__':unittest.main()
