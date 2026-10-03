"""Explicit, on-demand dataset download. No access to local browsing records."""
from __future__ import annotations
import csv
import datetime
import gzip
import hashlib
import io
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'vendor'))

def download(url):
    request=urllib.request.Request(url,headers={'User-Agent':'GhostTrace/0.1 dataset updater'})
    with urllib.request.urlopen(request,timeout=60) as response:
        return response.read()

def write(path,data):
    path=ROOT/path
    tmp=path.with_suffix(path.suffix+'.new')
    tmp.write_bytes(data)
    os.replace(tmp,path)

def rules_file(radar):
    mini={'trackers':{k:{'domain':v['domain'],'default':v.get('default','ignore'),'rules':[{a:b for a,b in x.items() if a in ('rule','action','exceptions')} for x in v.get('rules',[])]} for k,v in radar['trackers'].items()},'cnames':radar.get('cnames',{})}
    return ('/* DuckDuckGo Tracker Radar; CC BY-NC-SA 4.0. See THIRD_PARTY_NOTICES.md. */\nself.GHOSTTRACE_RULES='+json.dumps(mini,separators=(',',':'))+';\n').encode()

def main():
    import maxminddb
    print('Updating public datasets. Close the collector first; reload the extension after updating.')
    radar_raw=download('https://staticcdn.duckduckgo.com/trackerblocking/v2.1/tds.json')
    radar=json.loads(radar_raw)
    if not isinstance(radar.get('trackers'),dict) or len(radar['trackers'])<100:
        raise ValueError('Unexpected tracker dataset; keeping existing files')
    write(Path('data/tracker-radar.json'),radar_raw)
    write(Path('extension/tracker-rules.js'),rules_file(radar))
    print('Tracker domains:',len(radar['trackers']))
    raw=download('https://cppa.ca.gov/data_broker_registry/registry.csv').decode('utf-8-sig')
    rows=list(csv.DictReader(io.StringIO(raw)))
    fields=['Data broker name:','Doing Business As (DBA), if applicable:','Data broker primary website:']
    if not rows or any(field not in rows[0] for field in fields):
        raise ValueError('Registry format changed; keeping existing registry')
    out=io.StringIO(newline='');writer=csv.DictWriter(out,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(rows)
    write(Path('data/broker-registry.csv'),out.getvalue().encode())
    print('Registry entries:',len(rows))
    psl=download('https://publicsuffix.org/list/public_suffix_list.dat')
    if b'BEGIN ICANN DOMAINS' not in psl:
        raise ValueError('Unexpected suffix list; keeping existing file')
    write(Path('data/public_suffix_list.dat'),psl)
    releases={}
    for kind in ['country','asn']:
        today=datetime.date.today().replace(day=1)
        for attempt in range(4):
            release=today.strftime('%Y-%m')
            try:
                payload=gzip.decompress(download(f'https://download.db-ip.com/free/dbip-{kind}-lite-{release}.mmdb.gz'))
                break
            except urllib.error.HTTPError as error:
                if error.code!=404:raise
                today=(today-datetime.timedelta(days=1)).replace(day=1)
        else:
            raise ValueError('No recent DB-IP release available')
        temporary=ROOT/'data'/f'dbip-{kind}-validate.mmdb'
        try:
            temporary.write_bytes(payload)
            with maxminddb.open_database(str(temporary),mode=maxminddb.MODE_MMAP) as reader:
                if not reader.get('8.8.8.8'):raise ValueError('Invalid database')
        finally:
            temporary.unlink(missing_ok=True)
        write(Path(f'data/dbip-{kind}-lite.mmdb'),payload)
        releases[kind]=release
        print(kind.title(),'database:',release)
    meta=json.loads((ROOT/'data/SNAPSHOT.json').read_text())
    meta.update(downloaded=datetime.date.today().isoformat(),tracker_domains=len(radar['trackers']),broker_registry_entries=len(rows),dbip_release=releases)
    meta['sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'data').iterdir() if p.is_file() and p.name!='SNAPSHOT.json'}
    write(Path('data/SNAPSHOT.json'),json.dumps(meta,indent=2).encode())
    print('Done. Restart GhostTrace, then click Reload on the extension card.')

if __name__=='__main__':
    try:main()
    except Exception as error:raise SystemExit('Update stopped: '+str(error))
