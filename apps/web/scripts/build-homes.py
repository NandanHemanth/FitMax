"""Build public/data/homes.json from the CoStar hackathon kit (residential listings + features).
Usage: python3 scripts/build-homes.py <path to costar-hackathon-kit/data> public/data/homes.json"""
import json, sys

src, out = sys.argv[1], sys.argv[2]
ROOM_BITS = {1: 'bonus', 2: 'den', 4: 'office', 8: 'dining', 16: 'family', 32: 'gym', 64: 'gym'}
feats = {}
with open(f"{src}/residential-listing-features.jsonl") as f:
    for line in f:
        r = json.loads(line)
        tags = []
        for s in r.get("sections", []):
            if s.get("subcategory") in ("Interior Spaces", "Flooring"):
                tags += [l for l in s.get("lines", []) if len(l) < 40]
        feats[r["id"]] = {"tags": tags[:6], "dv": r.get("derivedValues") or {}}

homes, seen = [], set()
with open(f"{src}/residential-listings.jsonl") as f:
    for line in f:
        r = json.loads(line)
        p = r.get("property") or {}
        a = p.get("address") or {}
        lat, lng = a.get("latitude"), a.get("longitude")
        keys = [m.get("videoKey") for m in r.get("media") or [] if m.get("videoKey")]
        # Matterport model ids are 11 characters; other 3D-tour vendors use UUIDs
        mp = next((k for k in keys if len(k) == 11), None)
        if lat is None or not mp:
            continue
        key = a.get("fullStreetAddress", "") + a.get("zip", "")
        if key in seen:
            continue
        seen.add(key)
        reso = r.get("resoValues") or {}
        st = reso.get("structure") or {}
        rt = reso.get("roomType") or 0
        rooms = sorted({v for b, v in ROOM_BITS.items() if rt & b})
        thumb = next((m.get("thumbnailUri") for m in r.get("media") or [] if m.get("thumbnailUri")), None)
        fe = feats.get(r["id"], {})
        homes.append({
            "id": r["id"], "mp": mp,
            "addr": a.get("fullStreetAddress", ""), "city": a.get("city", ""), "st": a.get("state", ""),
            "lat": round(lat, 6), "lng": round(lng, 6),
            "beds": p.get("bedsMax") or 0, "baths": p.get("bathsMax") or 0, "sqft": p.get("sqftMax") or fe.get("dv", {}).get("homeSquareFeet"),
            "stories": st.get("stories") or fe.get("dv", {}).get("numberOfStories") or 1,
            "year": p.get("yearBuilt"), "garage": bool(reso.get("hasGarage")), "price": r.get("currentPrice"),
            "rent": r.get("transactionType") == 2, "style": st.get("architecturalStyle"),
            "gym": bool(reso.get("hasGym")) or "gym" in rooms, "rooms": rooms,
            "hardwood": bool(reso.get("hasHardwoodFloors")), "thumb": thumb, "tags": fe.get("tags", []),
            "type": p.get("mlsPropertyType"),
        })
homes = [h for h in homes if h["sqft"] and 300 < h["sqft"] < 12000]
homes.sort(key=lambda h: (h["city"], h["addr"]))
with open(out, "w") as f:
    json.dump(homes, f, separators=(",", ":"))
print(len(homes), "homes")
