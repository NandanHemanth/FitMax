"""Ask Matterport which CoStar scans are actually viewable and mark them in homes.json.
Adds  mpOk (bool) and mpThumb (preview image) to each home.  Run: python3 scripts/check-tours.py"""
import json, sys, urllib.request, concurrent.futures as cf
from collections import Counter

PATH = 'public/data/homes.json'
homes = json.load(open(PATH))

def check(mp):
    try:
        with urllib.request.urlopen(f'https://my.matterport.com/api/player/models/{mp}/', timeout=15) as r:
            d = json.load(r)
        ok = d.get('is_public') and not d.get('has_public_access_password') and d.get('status') in ('active', 'copying')
        return mp, bool(ok), d.get('status'), (d.get('image') or '').split('?')[0] or None
    except urllib.error.HTTPError as e:
        return mp, False, f'http {e.code}', None
    except Exception as e:
        return mp, None, 'error', None   # network trouble: unknown, leave as is

with cf.ThreadPoolExecutor(24) as ex:
    res = {mp: (ok, st, img) for mp, ok, st, img in ex.map(check, [h['mp'] for h in homes])}
print(Counter(st for _, st, _ in res.values()))
for h in homes:
    ok, st, img = res[h['mp']]
    if ok is None: continue
    h['mpOk'] = ok
    if ok and img: h['mpThumb'] = img
json.dump(homes, open(PATH, 'w'), separators=(',', ':'))
print('viewable:', sum(1 for h in homes if h.get('mpOk')), 'of', len(homes))
