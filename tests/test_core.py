"""Privacy, attribution, geographic coverage, retention, and local HTTP boundary checks."""
import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ghosttrace.intel import Intel, ROOT, host
from ghosttrace.store import Store
from ghosttrace.server import Server


class CoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.intel=Intel()

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=Store(Path(self.tmp.name)/'events.db',self.intel,max_events=3)

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def event(self, identity='one', **kwargs):
        return {'id':identity,'ts':time.time()*1000,'site':'news.example','domain':'google-analytics.com','ip':'8.8.8.8','type':'script','state':'response',**kwargs}

    def test_sensitive_fields_discarded(self):
        event=self.event(domain='https://google-analytics.com/SECRET_PATH?fbclid=SECRET_QUERY',site='https://news.example/account/SECRET_ACCOUNT',
                         headers={'Cookie':'SECRET_COOKIE'},body='SECRET_BODY',evidence={'cookie_sent':True,'cookie_value':'SECRET_VALUE','identifier_params':['fbclid','SECRET_PARAM']})
        self.store.ingest([event])
        saved=self.store.events()[0]
        self.assertEqual(saved['domain'],'google-analytics.com')
        self.assertEqual(saved['site'],'news.example')
        self.assertEqual(saved['evidence']['identifier_params'],['fbclid'])
        self.assertNotIn('SECRET',json.dumps(saved))
        self.assertTrue(saved['evidence']['cookie_sent'])

    def test_shared_ip_does_not_imply_tracker_or_broker(self):
        unknown=self.intel.classify('unclassified.example','news.example',{})
        self.assertEqual(unknown['flags'],[])
        self.assertFalse(unknown['broker'])
        self.assertEqual(self.intel.classify('google.com','news.example',{})['flags'],[])

    def test_broker_registry_affiliation(self):
        info=self.intel.classify('rlcdn.com','news.example',{})
        self.assertIn('broker',info['flags'])
        self.assertIn('LiveRamp',info['broker']['name'])
        self.assertIn('not proof',info['broker']['evidence'])

    def test_public_suffix_boundaries(self):
        self.assertEqual(self.intel.site('a.example.co.uk'),'example.co.uk')
        self.assertEqual(self.intel.site('a.customer.github.io'),'customer.github.io')
        self.assertEqual(self.intel.site('www.city.kawasaki.jp'),'city.kawasaki.jp')
        self.assertEqual(host('https://User:Password@EXAMPLE.COM/private?secret=1'),'example.com')

    def test_country_and_asn_ipv4_ipv6(self):
        self.assertIn('country',self.intel.readers)
        self.assertIn('asn',self.intel.readers)
        for address in ['8.8.8.8','2606:4700:4700::1111']:
            geo=self.intel.geo(address)
            self.assertTrue(geo['country_code'])
            self.assertIsNotNone(geo['lat'])
            self.assertIsNotNone(geo['asn'])
        self.assertEqual(self.intel.geo('127.0.0.1')['precision'],'unknown')

    def test_dedup_cap_retention_and_cache(self):
        self.assertEqual(self.store.ingest([self.event()]),1)
        self.assertEqual(self.store.ingest([self.event()]),0)
        self.store.ingest([self.event(str(i),ts=time.time()*1000+i,state='cached') for i in range(4)])
        self.assertEqual(len(self.store.events()),3)
        self.assertTrue(all(not e['ip'] for e in self.store.events()))
        self.store.ingest([self.event('old',ts=(time.time()-8*86400)*1000)])
        self.assertFalse(any(e['id']=='old' for e in self.store.events()))

    def test_identifier_is_signal_not_proof(self):
        self.store.ingest([self.event(domain='unknown.example',evidence={'identifier_params':['gclid']})])
        saved=self.store.events()[0]
        self.assertEqual(saved['attribution']['flags'],['suspected'])
        self.assertFalse(saved['attribution']['broker'])


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.server.store.set_setting('paused',False)
        self.server.store.clear()

    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.server=Server(('127.0.0.1',0),state_dir=cls.tmp.name)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.server.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.server.store.db.close();cls.tmp.cleanup()

    def request(self,path,body=None,auth=False,headers=None):
        h={'Authorization':'Bearer '+self.server.token} if auth else {}
        if body is not None:h['Content-Type']='application/json'
        h.update(headers or {})
        req=urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=h)
        try:
            with urllib.request.urlopen(req,timeout=5) as response:return response.status,response.read()
        except urllib.error.HTTPError as error:return error.code,error.read()

    def test_auth_and_origin_boundary(self):
        self.assertEqual(self.request('/api/dashboard')[0],401)
        self.assertEqual(self.request('/api/setup',headers={'Origin':'https://hostile.example'})[0],403)
        self.assertEqual(self.request('/api/setup',headers={'Sec-Fetch-Site':'cross-site'})[0],403)
        self.assertEqual(self.request('/api/setup',headers={'Host':'rebind.example'})[0],403)
        self.assertEqual(self.request('/api/status',auth=True)[0],200)

    def test_capture_pause_and_clear(self):
        event={'id':'http-test','domain':'rlcdn.com','site':'news.example','ip':'8.8.8.8','state':'response'}
        self.assertEqual(json.loads(self.request('/api/events',{'events':[event]},True)[1])['accepted'],1)
        self.request('/api/settings',{'paused':True},True)
        event['id']='paused-event'
        self.assertEqual(json.loads(self.request('/api/events',{'events':[event]},True)[1])['accepted'],0)
        self.assertEqual(self.request('/api/clear',{},True)[0],200)
        self.assertEqual(json.loads(self.request('/api/dashboard',auth=True)[1])['stats']['requests'],0)

    def test_malformed_payload_and_traversal(self):
        self.assertEqual(self.request('/api/events',{'events':[{'id':'invalid','domain':'bad host'}]},True)[0],400)
        self.assertEqual(self.request('/../run.py')[0],404)


if __name__=='__main__':unittest.main()
