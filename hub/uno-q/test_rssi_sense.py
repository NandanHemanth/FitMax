"""Tests for the multi-link sensing hub. Run: python3 -m unittest -v test_rssi_sense.py"""
import math
import random
import unittest

import rssi_sense as rs

LINKS = rs.SyntheticWorld.LINKS


def run(script, seconds, quantize=True, seed=3, calibrate_after=None, fusion=None, t0=1_700_000_000.0):
    """Drive a Fusion with a synthetic world for `seconds`; returns (fusion, list of states)."""
    w = rs.SyntheticWorld(script=script, seed=seed, quantize=quantize)
    fu = fusion or rs.Fusion(inactivity_s=600)
    states = []
    for i in range(int(seconds * rs.HZ)):
        t = i / rs.HZ
        now = t0 + t
        for (a, b) in LINKS:
            fu.link(a, b, "wifi").push(w.rssi((a, b), t), now)
        fu.step(now)
        if calibrate_after is not None and abs(t - calibrate_after) < 1e-6:
            fu.calibrate_empty()
        states.append(dict(fu.state))
    return fu, states


class Flicker(unittest.TestCase):
    def test_empty_room_with_hotspot_flicker_counts_no_reps(self):
        fu, states = run([(600, "empty", None)], 300)
        self.assertEqual(states[-1]["exercise"]["reps"], 0)
        self.assertFalse(any(s.get("exercise", {}).get("periodic") for s in states if s))
        self.assertFalse(states[-1]["presence"])

    def test_still_person_with_flicker_counts_no_reps(self):
        _, states = run([(600, "still", (1.2, 1.2))], 240)
        self.assertEqual(states[-1]["exercise"]["reps"], 0)


class Reps(unittest.TestCase):
    def test_squats_counted_within_two(self):
        # 20 s empty (calibration), 36 s squats at 25/min = 15 reps, then still
        script = [(20, "empty", None), (56, "squats", (2.0, 0.6)), (90, "still", (1.0, 2.0))]
        fu, states = run(script, 89, calibrate_after=18)
        total = states[-1]["exercise"]["reps"]
        self.assertTrue(13 <= total <= 17, total)
        self.assertEqual(len(fu.sets), 1)
        self.assertTrue(20 <= fu.sets[0]["cadence"] <= 30, fu.sets[0])

    def test_walking_is_motion_not_reps(self):
        _, states = run([(20, "empty", None), (80, "walk", None)], 79, calibrate_after=18)
        walking = [s for s in states[300:] if s]
        self.assertGreater(sum(s["motion_level"] in ("present_moving", "active") for s in walking) / len(walking), 0.6)
        self.assertLessEqual(states[-1]["exercise"]["reps"], 3)


class Location(unittest.TestCase):
    def test_zone_follows_the_disturbed_link(self):
        # Squatting right on the laptop<->ap line
        _, states = run([(20, "empty", None), (60, "squats", (2.9, 1.5))], 59, calibrate_after=18)
        s = states[-1]
        self.assertIn("laptop", s["zone"])
        self.assertIn("ap", s["zone"])
        x, y = s["position"]
        self.assertLess(math.dist((x, y), (2.9, 1.5)), 1.3)
        self.assertEqual(len(s["field"]["values"]), 20 * 15)


class Breathing(unittest.TestCase):
    def test_breathing_rate_from_float_rssi(self):
        _, states = run([(20, "empty", None), (120, "lying", (2.0, 0.35))], 119, quantize=False, calibrate_after=18)
        b = states[-1]["breathing"]
        self.assertIsNotNone(b["bpm"], b)
        self.assertLess(abs(b["bpm"] - 14), 2.0)

    def test_no_breathing_claimed_in_empty_room(self):
        _, states = run([(600, "empty", None)], 120)
        self.assertIsNone(states[-1]["breathing"]["bpm"])


class Fall(unittest.TestCase):
    def test_spike_then_stillness_in_new_spot_raises_fall(self):
        fu = rs.Fusion()
        rng = random.Random(5)
        t0 = 1_700_000_000.0
        for i in range(int(60 * rs.HZ)):
            t = i / rs.HZ
            for (a, b) in LINKS:
                base = rs.SyntheticWorld.BASE[(a, b)]
                v = base + rng.gauss(0, 0.3)
                if (a, b) == ("uno", "ap"):
                    if 20 <= t < 30:
                        v += rng.gauss(0, 2.0)  # walking
                    elif 30 <= t < 31.2:
                        v += rng.choice((-12, 10, -9, 8))  # impact
                    elif t >= 31.2:
                        v -= 5.0  # lying on the floor across the link
                fu.link(a, b, "wifi").push(round(v), t0 + t)
            fu.step(t0 + t)
        self.assertTrue(fu.state["fall"]["active"])

    def test_squats_do_not_raise_fall(self):
        fu, _ = run([(20, "empty", None), (80, "squats", (2.0, 0.6))], 79, calibrate_after=18)
        self.assertFalse(fu.state["fall"]["active"])


class Parsers(unittest.TestCase):
    def test_station_dump(self):
        out = """Station 3a:2b:aa:bb:cc:dd (on wlan0)
\tinactive time:\t20 ms
\ttx retries:\t12
\ttx failed:\t1
\tsignal:  \t-57 [-59, -60] dBm
\tsignal avg:\t-56 dBm
\tbeacon signal avg:\t-55 dBm
\ttx bitrate:\t72.2 MBit/s
\trx bitrate:\t65.0 MBit/s"""
        f = rs.parse_station_dump(out)
        self.assertEqual(f["signal"], -57)
        self.assertEqual(f["tx_retries"], 12)
        self.assertEqual(f["rx_bitrate"], 65.0)

    def test_survey(self):
        out = """Survey data from wlan0
\tfrequency:\t2412 MHz
\tnoise:\t-95 dBm
Survey data from wlan0
\tfrequency:\t2437 MHz [in use]
\tnoise:\t-92 dBm
\tchannel active time:\t1000 ms
\tchannel busy time:\t300 ms"""
        s = rs.parse_survey(out)
        self.assertEqual(s["noise"], -92)
        self.assertEqual(s["busy_ms"], 300)

    def test_interference_pauses_motion(self):
        fu = rs.Fusion()
        t0 = 1_700_000_000.0
        for i in range(400):
            l = fu.link("uno", "ap", "wifi")
            noise = -95 if i < 300 else -80  # microwave on
            l.push(-50 + (3 if i % 3 == 0 else 0) * (i >= 300), t0 + i / 10, {"noise": noise})
            fu.step(t0 + i / 10)
        self.assertTrue(fu.state["interference"])
        self.assertEqual(fu.state["motion_level"], "absent")


if __name__ == "__main__":
    unittest.main()


class Http(unittest.TestCase):
    """End to end: hub in synthetic mode + a pushed link from an 'agent'."""

    @classmethod
    def setUpClass(cls):
        import socket, subprocess, sys, time
        s = socket.socket(); s.bind(("127.0.0.1", 0)); cls.port = s.getsockname()[1]; s.close()
        cls.p = subprocess.Popen([sys.executable, "rssi_sense.py", "serve", "--token", "T", "--port", str(cls.port), "--source", "synthetic"], stdout=subprocess.DEVNULL)
        time.sleep(4.5)

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()

    def call(self, path, body=None, token="T"):
        import json, urllib.request, urllib.error
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=None if body is None else json.dumps(body).encode(), headers={"Authorization": f"Bearer {token}"} if token else {})
        try:
            with urllib.request.urlopen(req, timeout=3) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, None

    def test_health_is_open_api_needs_token(self):
        self.assertEqual(self.call("/health", token=None)[0], 200)
        self.assertEqual(self.call("/api/v1/sensing/latest", token="wrong")[0], 401)

    def test_latest_has_links_and_capabilities(self):
        code, s = self.call("/api/v1/sensing/latest")
        self.assertEqual(code, 200)
        self.assertGreaterEqual(len(s["links"]), 3)
        self.assertIn("breathing", s["capabilities"])
        self.assertIn("classification", s)

    def test_ingest_layout_calibrate_label_recent(self):
        self.assertEqual(self.call("/api/v1/links/ingest", {"node": "pc", "links": [{"a": "pc", "b": "ap", "kind": "wifi", "values": [-50, -51, -50] * 10}]})[0], 200)
        code, lay = self.call("/api/v1/layout", {"room": [5, 4], "nodes": {"uno": [0, 0], "ap": [5, 0], "laptop": [2.5, 4]}})
        self.assertEqual(lay["room"], [5.0, 4.0])
        self.assertEqual(self.call("/api/v1/calibrate/empty", {})[0], 200)
        self.assertEqual(self.call("/api/v1/label", {"label": "squats"})[0], 200)
        code, rec = self.call("/api/v1/rssi/recent?seconds=5")
        self.assertIn("pc-ap", rec["links"])
        self.assertEqual(rec["labels"][-1]["label"], "squats")
