#!/usr/bin/env python3
"""
FitMax WiFi sensing hub v2: multi-link RSSI sensing with no extra hardware.

Hardware it needs: the Arduino UNO Q and a laptop, both joined to the same WiFi (e.g. an iPhone
hotspot). Every radio link between two devices is a sensor: a body (mostly water) absorbs and
scatters 2.4/5 GHz energy, so the link's received signal strength (RSSI) dips and jitters when
someone moves near its line. Three devices give three links (a triangle), which is enough for a
coarse radio-tomographic image (RTI, Wilson & Patwari 2010): which part of the room the motion
is in, not just whether there is motion.

  board : UNO Q  <-> phone hotspot   (WiFi, measured on the board)
  laptop: laptop <-> phone hotspot   (WiFi, measured on the laptop, pushed to the board)
  ble   : laptop <-> UNO Q           (Bluetooth LE adverts, optional, pushed by the laptop)

What it measures, and how sure it is (see `CAPABILITIES`):
  presence, motion level, active minutes, intensity minutes, zone / coarse position, heat map,
  repetitive-exercise rhythm with a rep counter and sets, sedentary bouts, lying-still / sleep
  restlessness, 2.4 GHz interference (e.g. a microwave oven), and EXPERIMENTAL breathing rate
  (Patwari et al. 2014; UbiBreathe 2015) and possible-fall events. Heart rate needs CSI hardware
  and is never guessed.

Modes (one file, Python standard library only):
  python3 rssi_sense.py serve --token T            # on the UNO Q: sample, fuse, serve the API on :3000
  python3 rssi_sense.py agent --hub http://<board>:3000 --token T --name laptop [--ble-peer AA:BB:..]
                                                   # on the laptop: sample its own links, push to the hub
  python3 rssi_sense.py serve --token T --source synthetic   # offline demo, no radios needed
"""
import argparse
import json
import math
import os
import random
import re
import shutil
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HZ = 10.0
VERSION = "2.0"

CAPABILITIES = {
    "presence": "reliable",
    "motion": "reliable",
    "active_minutes": "reliable",
    "rep_rhythm": "good when you train across a link",
    "zone": "coarse, needs 2+ links",
    "position_heatmap": "coarse, needs 3 links",
    "sleep_restlessness": "good",
    "interference": "good",
    "breathing": "experimental: lie still within ~1 m of a link",
    "fall": "experimental: sudden motion then stillness",
    "heart_rate": "not possible with RSSI (needs CSI hardware)",
}


# ================================================================ link samplers
def parse_station_dump(out):
    """Fields from `iw dev <if> station dump` (first station = the access point)."""
    f = {}
    for key, rx in (
        ("signal", r"^\s*signal:\s*(-?\d+)"),
        ("signal_avg", r"^\s*signal avg:\s*(-?\d+)"),
        ("beacon_avg", r"^\s*beacon signal avg:\s*(-?\d+)"),
        ("tx_retries", r"^\s*tx retries:\s*(\d+)"),
        ("tx_failed", r"^\s*tx failed:\s*(\d+)"),
        ("rx_bitrate", r"^\s*rx bitrate:\s*([\d.]+)"),
        ("tx_bitrate", r"^\s*tx bitrate:\s*([\d.]+)"),
    ):
        m = re.search(rx, out, re.M)
        if m:
            f[key] = float(m.group(1))
    return f


def parse_survey(out):
    """Noise floor (dBm) and busy fraction of the channel in use, from `iw dev <if> survey dump`."""
    for block in out.split("Survey data from")[1:]:
        if "[in use]" not in block:
            continue
        noise = re.search(r"noise:\s*(-?\d+)", block)
        active = re.search(r"channel active time:\s*(\d+)", block)
        busy = re.search(r"channel busy time:\s*(\d+)", block)
        return {
            "noise": float(noise.group(1)) if noise else None,
            "active_ms": float(active.group(1)) if active else None,
            "busy_ms": float(busy.group(1)) if busy else None,
        }
    return None


def run(cmd, timeout=1.0):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""


def default_iface():
    m = re.search(r"Interface\s+(\S+)", run(["iw", "dev"], 2))
    return m.group(1) if m else "wlan0"


def default_gateway():
    try:
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                parts = line.split()
                if parts[1] == "00000000":
                    g = int(parts[2], 16)
                    return ".".join(str((g >> (8 * i)) & 255) for i in range(4))
    except Exception:
        pass
    return None


class WifiSampler:
    """This device's own WiFi link to the access point: RSSI + link-layer counters + ping RTT."""

    def __init__(self, iface, gateway, source="auto"):
        self.iface, self.gateway, self.source = iface, gateway, source
        self.rtt = None
        self.survey = None
        self._prev = {}
        self._t0 = time.time()
        if gateway and shutil.which("ping") and source != "synthetic":
            # Pinging the router keeps frames flowing, so RSSI updates ~5x/s even when idle
            threading.Thread(target=self._ping_loop, daemon=True).start()
        if source != "synthetic" and shutil.which("iw"):
            threading.Thread(target=self._survey_loop, daemon=True).start()

    def _ping_loop(self):
        while True:
            try:
                p = subprocess.Popen(["ping", "-n", "-i", "0.2", self.gateway], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                for line in p.stdout:
                    m = re.search(r"time[=<]([\d.]+)", line)
                    if m:
                        self.rtt = float(m.group(1))
            except Exception:
                pass
            time.sleep(2)

    def _survey_loop(self):
        while True:
            s = parse_survey(run(["iw", "dev", self.iface, "survey", "dump"], 2))
            if s:
                self.survey = s
            time.sleep(2)

    def sample(self):
        """(rssi_dbm or None, extras dict)."""
        if self.source == "synthetic":
            return None, {}
        if self.source in ("auto", "iw") and shutil.which("iw"):
            f = parse_station_dump(run(["iw", "dev", self.iface, "station", "dump"]))
            if "signal" in f:
                ex = {"rtt": self.rtt}
                for k in ("tx_retries", "tx_failed"):
                    if k in f:
                        ex[k + "_d"] = max(0.0, f[k] - self._prev.get(k, f[k]))
                        self._prev[k] = f[k]
                for k in ("rx_bitrate", "tx_bitrate", "beacon_avg"):
                    if k in f:
                        ex[k] = f[k]
                if self.survey:
                    ex["noise"] = self.survey.get("noise")
                return f["signal"], ex
        if self.source in ("auto", "proc"):
            try:
                with open("/proc/net/wireless") as fh:
                    for line in fh:
                        if line.strip().startswith(self.iface + ":"):
                            level = float(line.split()[3].rstrip("."))
                            return (level - 256 if level > 0 else level), {"rtt": self.rtt}
            except Exception:
                pass
        return None, {}


class BleSampler:
    """Optional: RSSI of a peer's Bluetooth LE adverts (needs `pip install bleak`). Thread-safe latest value."""

    def __init__(self, peer):
        self.peer = peer.upper()
        self.value, self.at, self.error = None, 0.0, None
        try:
            import asyncio  # noqa: F401
            import bleak  # noqa: F401
        except Exception as e:  # bleak missing: report it, keep running WiFi-only
            self.error = f"BLE off: {e}. Run `pip install bleak`."
            return
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        import asyncio
        from bleak import BleakScanner

        def cb(dev, adv):
            if dev.address.upper() == self.peer:
                self.value, self.at = float(adv.rssi), time.time()

        async def main():
            async with BleakScanner(cb):
                while True:
                    await asyncio.sleep(1)

        try:
            asyncio.run(main())
        except Exception as e:
            self.error = f"BLE scan failed: {e}"

    def sample(self):
        return self.value if time.time() - self.at < 2.0 else None


# ================================================================ synthetic world (demo + tests)
class SyntheticWorld:
    """A person moving in a 4 x 3 m room with three devices. Produces realistic per-link RSSI:
    shadowing when the body is near a link line, motion-induced multipath jitter, breathing
    micro-motion, 1 dB quantisation and occasional level flicker like a phone hotspot."""

    NODES = {"uno": (0.3, 0.3), "ap": (3.7, 0.3), "laptop": (2.0, 2.7)}
    LINKS = (("uno", "ap"), ("laptop", "ap"), ("laptop", "uno"))
    BASE = {("uno", "ap"): -48.0, ("laptop", "ap"): -52.0, ("laptop", "uno"): -60.0}

    def __init__(self, script=None, seed=1, quantize=True):
        self.rng = random.Random(seed)
        self.script = script or self.default_script()
        self.quantize = quantize
        self._flick = {l: 0.0 for l in self.LINKS}

    @staticmethod
    def default_script():
        # (until_s, activity, (x, y))  — loops
        return [
            (15, "empty", None), (30, "walk", None), (55, "squats", (2.0, 0.6)),
            (75, "still", (1.2, 1.2)), (105, "lying", (2.6, 0.5)), (120, "walk", None),
        ]

    def state(self, t):
        loop = self.script[-1][0]
        tt = t % loop
        for until, act, pos in self.script:
            if tt < until:
                return act, pos, tt
        return self.script[-1][1], self.script[-1][2], tt

    def person(self, t):
        act, pos, tt = self.state(t)
        if act == "empty":
            return None, act
        if act == "walk":
            ang = 2 * math.pi * tt / 9.0
            return (2.0 + 1.3 * math.cos(ang), 1.4 + 0.9 * math.sin(ang)), act
        return pos, act

    @staticmethod
    def seg_dist(p, a, b):
        ax, ay = a
        bx, by = b
        px, py = p
        dx, dy = bx - ax, by - ay
        u = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + u * dx), py - (ay + u * dy))

    def rssi(self, link, t):
        a, b = self.NODES[link[0]], self.NODES[link[1]]
        v = self.BASE[link] + self.rng.gauss(0, 0.35)
        # hotspot flicker: rare 1-2 dB level steps that hold for a moment (the 208-reps bug)
        if self.rng.random() < 0.005:  # ~every 20 s per link
            self._flick[link] = self.rng.choice((-2.0, -1.0, 1.0, 0.0))
        v += self._flick[link]
        p, act = self.person(t)
        if p is not None:
            d = self.seg_dist(p, a, b)
            near = math.exp(-(d / 0.45) ** 2)
            v -= 6.0 * near  # body shadowing on the line of sight
            if act == "walk":
                v += self.rng.gauss(0, 2.2) * (0.35 + near)
            elif act == "squats":
                v += -5.0 * near * (0.5 - 0.5 * math.cos(2 * math.pi * t / 2.4)) + self.rng.gauss(0, 0.3)  # torso dips through the line
            elif act in ("still", "lying"):
                v += 1.2 * near * math.sin(2 * math.pi * (14 / 60.0) * t)  # breathing, 14 br/min
        return round(v) if self.quantize else v


# ================================================================ DSP helpers
def pctl(xs, q):
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, int(q * (len(s) - 1))))] if s else 0.0


def moving_avg(xs, k):
    out, acc, q = [], 0.0, deque()
    for x in xs:
        q.append(x)
        acc += x
        if len(q) > k:
            acc -= q.popleft()
        out.append(acc / len(q))
    return out


def autocorr(xs, hi):
    """Normalised autocorrelation for lags 0..hi (unbiased)."""
    n = len(xs)
    m = statistics.fmean(xs)
    d = [x - m for x in xs]
    var = sum(v * v for v in d)
    if var <= 1e-9 or n <= hi + 2:
        return None
    return [sum(d[i] * d[i + lag] for i in range(n - lag)) / var * n / (n - lag) for lag in range(hi + 1)]


def autocorr_peak(xs, lo, hi):
    """A real rhythm's autocorrelation swings negative at half a period and peaks again at one
    period. Level steps and slow drifts only decay. Returns (lag, r) of the first true peak in
    lo..hi that follows a trough below -0.1, or (None, 0)."""
    if len(xs) < hi * 2:
        return None, 0.0
    ac = autocorr(xs, hi)
    if ac is None:
        return None, 0.0
    trough = next((l for l in range(1, hi) if ac[l] < -0.1), None)  # first dip below zero…
    if trough is None:
        return None, 0.0
    while trough + 1 < hi and ac[trough + 1] < ac[trough]:  # …down to its bottom
        trough += 1
    peaks = [l for l in range(max(lo, trough + 1), hi) if ac[l] > 0 and ac[l] >= ac[l - 1] and ac[l] >= ac[l + 1]]
    if not peaks:
        return None, 0.0
    top = max(ac[l] for l in peaks)
    best = next(l for l in peaks if ac[l] >= 0.85 * top)  # first strong peak, not a 2x multiple
    return best, ac[best]


def count_peaks(xs, min_gap, min_prom):
    """Count local maxima at least `min_gap` samples apart that rise `min_prom` above the
    lowest point since the previous peak."""
    n, last, low, peaks = len(xs), -10 ** 9, float("inf"), 0
    for i in range(1, n - 1):
        low = min(low, xs[i])
        if xs[i] >= xs[i - 1] and xs[i] > xs[i + 1] and i - last >= min_gap and xs[i] - low >= min_prom:
            peaks += 1
            last, low = i, xs[i]
    return peaks


def spectrum(xs, f_lo, f_hi, step, hz=HZ):
    """Magnitude spectrum at f_lo..f_hi (Hz) of a detrended, Hann-windowed series (plain DFT)."""
    n = len(xs)
    if n < 8:
        return []
    # linear detrend
    tm = (n - 1) / 2
    xm = statistics.fmean(xs)
    sxy = sum((i - tm) * (x - xm) for i, x in enumerate(xs))
    sxx = sum((i - tm) ** 2 for i in range(n))
    slope = sxy / sxx if sxx else 0.0
    w = [(x - xm - slope * (i - tm)) * (0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1))) for i, x in enumerate(xs)]
    out = []
    for f, cs, sn in _twiddles(n, f_lo, f_hi, step, hz):
        out.append((f, math.hypot(sum(a * b for a, b in zip(w, cs)), sum(a * b for a, b in zip(w, sn)))))
    return out


_TW = {}


def _twiddles(n, f_lo, f_hi, step, hz):
    key = (n, f_lo, f_hi, step, hz)
    if key not in _TW:
        rows, f = [], f_lo
        while f <= f_hi + 1e-9:
            k = 2 * math.pi * f / hz
            rows.append((f, [math.cos(k * i) for i in range(n)], [math.sin(k * i) for i in range(n)]))
            f += step
        _TW.clear()
        _TW[key] = rows
    return _TW[key]


def seg_dist(p, a, b):
    return SyntheticWorld.seg_dist(p, a, b)


# ================================================================ per-link state
class Link:
    def __init__(self, a, b, kind):
        self.a, self.b, self.kind = a, b, kind
        self.id = f"{a}-{b}"
        self.v = deque(maxlen=int(HZ * 300))
        self.last_at = 0.0
        self.extra = {}
        self.e_hist = deque(maxlen=int(HZ * 300))
        self.sd0 = None  # calibrated empty-room std (dB)
        self.e0 = None  # calibrated empty-room motion energy
        self.floor = 0.4
        self._fed_at = 0.0
        self._quiet_run = 0
        self.last_quiet = 0.0
        self.p2p_hist = deque(maxlen=int(HZ * 30))
        self.base = None  # calibrated empty-room mean (dB)
        self.f = {"z": 0.0, "shift": 0.0, "mean": None, "sd": 0.0, "sparse": False}

    def push(self, v, now, extra=None):
        if v is None:
            return
        self.v.append(float(v))
        self.last_at = now
        if extra:
            self.extra = extra

    def fresh(self, now):
        return now - self.last_at < 3.0 and len(self.v) >= HZ * 3

    def update(self, now):
        if not self.fresh(now):
            self.f = {"z": 0.0, "shift": 0.0, "mean": None, "sd": 0.0, "sparse": False}
            return self.f
        win = list(self.v)[-int(HZ * 3):]
        diffs = [abs(b - a) for a, b in zip(win, win[1:])]
        sd = statistics.pstdev(win)
        # Motion = sustained fluctuation. Clip each step so a single hotspot level jump
        # (one big diff, then flat) can't look like someone moving.
        e = statistics.fmean(min(d, 1.5) for d in diffs)
        # Noise floor = median energy of this link's QUIET moments over the last ~5 min. Only
        # quiet samples (or one sample every 5 s, to follow slow changes) feed it, so a long
        # workout can't raise the floor and hide itself. Calibration pins it to the empty room.
        floor = self.floor
        if e < 1.6 * floor or now - self._fed_at > 5.0:
            self.e_hist.append(e)
            self._fed_at = now
        if self.e0 is None and len(self.e_hist) > HZ * 10:
            floor = self.floor = max(0.3, pctl(self.e_hist, 0.75))
        z = e / floor
        if z < 1.3 and (self.base is None or abs(statistics.fmean(win) - self.base) < 2.0 * max(self.sd0 or 0.5, 0.5)):
            self._quiet_run += 1
            if self._quiet_run >= HZ * 2:
                self.last_quiet = now
        else:
            self._quiet_run = 0
        zero = sum(1 for d in diffs if d == 0) / max(1, len(diffs))
        sparse = zero > 0.75 and len(set(win)) <= 3  # level flicker, not motion
        if sparse:
            z = min(z, 1.6)
        short = win[-int(HZ * 1.5):]
        p2p = max(short) - min(short)
        self.p2p_hist.append(p2p)
        mean = statistics.fmean(win)
        shift = 0.0
        if self.base is not None:
            shift = abs(mean - self.base) / max(self.sd0 or 0.5, 0.5)
        self.f = {"z": z, "shift": shift, "mean": mean, "sd": sd, "sparse": sparse, "p2p": p2p,
                  "p2p_typ": pctl(list(self.p2p_hist)[-int(HZ * 20):], 0.5)}
        return self.f

    def calibrate(self):
        if len(self.v) >= HZ * 8:
            w = list(self.v)[-int(HZ * 15):]
            self.base, self.sd0 = statistics.fmean(w), max(0.3, statistics.pstdev(w))
            d = [min(abs(b - a), 1.5) for a, b in zip(w, w[1:])]
            # a 3 s window's energy in the empty room, upper-quartile so noise bursts stay below 2x
            es = [statistics.fmean(d[i:i + int(HZ * 3)]) for i in range(0, max(1, len(d) - int(HZ * 3)), 5)]
            self.e0 = self.floor = max(0.3, pctl(es, 0.75))
        return {"base": self.base, "sd": self.sd0, "floor": self.e0}


# ================================================================ fusion
class Fusion:
    """Turns all links into one picture of the home, ~10x a second."""

    def __init__(self, inactivity_s=600, layout=None):
        self.links = {}
        self.inactivity_s = inactivity_s
        self.layout = layout or {"room": [4.0, 3.0], "nodes": {k: list(v) for k, v in SyntheticWorld.NODES.items()}}
        self.last_motion = 0.0
        self.since = {"state": "absent", "at": time.time()}
        self.state = {}
        self.day = time.strftime("%Y-%m-%d")
        self.totals = {"active_s": 0.0, "intense_s": 0.0, "present_s": 0.0, "lying_s": 0.0, "restless": 0}
        self.sets = []  # finished sets today
        self.cur = None  # current set: {"start", "reps", "cadence", "link"}
        self._lags = deque(maxlen=4)
        self._best_hist = deque(maxlen=int(HZ * 10))
        self._zrun = deque(maxlen=int(HZ))
        self._loud_at = 0.0
        self._cand_since = None
        self._lost_at = None
        self._eval_at = 0.0
        self._rhythm = {"periodic": False, "cadence_per_min": None, "correlation": 0.0, "amplitude_db": 0.0}
        self._breath = {"bpm": None, "confidence": 0.0}
        self._breath_at = 0.0
        self.fall = {"active": False, "at": None}
        self._impact = None
        self._noise = deque(maxlen=300)
        self.interference = False
        self.labels = deque(maxlen=200)
        self._prev_t = None
        self._was_lying_move = False
        self.events = deque(maxlen=50)

    # ---------------------------------------------------------- links
    def link(self, a, b, kind):
        key = f"{a}-{b}"
        if key not in self.links:
            self.links[key] = Link(a, b, kind)
        return self.links[key]

    def calibrate_empty(self):
        return {k: l.calibrate() for k, l in self.links.items()}

    # ---------------------------------------------------------- main step
    def step(self, now):
        if time.strftime("%Y-%m-%d", time.localtime(now)) != self.day:
            self.day = time.strftime("%Y-%m-%d", time.localtime(now))
            self.totals = {k: 0 for k in self.totals}
            self.sets, self.cur = [], None
        dt = 0.0 if self._prev_t is None else min(1.0, max(0.0, now - self._prev_t))
        self._prev_t = now

        feats = {k: l.update(now) for k, l in self.links.items()}
        live = [k for k, l in self.links.items() if l.fresh(now)]
        if not live:
            self.state = {}
            return
        self._interference(now)
        zs = {k: feats[k]["z"] for k in live}
        best = max(live, key=lambda k: zs[k])
        z = zs[best]
        shifted = any(feats[k]["shift"] > 3.0 for k in live)
        self._zrun.append(z)
        # moving = clearly above the floor for most of the last second (one blip isn't motion)
        moving = sum(1 for v in self._zrun if v > 2.4) >= 8 and not self.interference
        active = moving and sum(1 for v in self._zrun if v > 3.5) >= 6
        if moving:
            self.last_motion = now
        presence = (now - self.last_motion) < self.inactivity_s or shifted

        self._rhythm_step(now, best, moving)
        periodic = self._rhythm["periodic"]
        level = "absent" if not presence else "active" if (active or periodic) else "present_moving" if moving else "present_still"

        # How long in the current state; "lying" = still for 5+ min (sleep / rest)
        coarse = "absent" if not presence else "still" if level == "present_still" else "moving"
        if coarse != self.since["state"]:
            if self.since["state"] == "still" and coarse == "moving" and now - self.since["at"] > 300:
                self.totals["restless"] += 1 if self._lying(now) else 0
            self.since = {"state": coarse, "at": now}
        still_for = now - self.since["at"] if coarse == "still" else 0.0
        lying = coarse == "still" and still_for >= 300

        activity = (
            "away" if not presence else "exercising" if periodic else "very active" if active else
            "walking / moving" if moving else "lying still" if lying else "still"
        )
        if presence:
            self.totals["present_s"] += dt
        if moving or periodic:
            self.totals["active_s"] += dt
        if active or periodic:
            self.totals["intense_s"] += dt
        if lying:
            self.totals["lying_s"] += dt

        if z >= 3.0:
            self._loud_at = now
        self._breathing_step(now, live, presence and not periodic and now - self._loud_at >= 20)
        self._fall_step(now, best, z, coarse)

        pos, field, zone = self._locate(live, zs)
        conf = min(0.95, 0.5 + 0.08 * abs(z - 2.2)) if presence else min(0.9, 0.5 + (now - self.last_motion) / (self.inactivity_s * 4))
        reps_today = sum(s["reps"] for s in self.sets) + (self.cur["reps"] if self.cur else 0)
        self.state = {
            "presence": presence,
            "motion_level": level,
            "activity": activity,
            "confidence": round(conf, 2),
            "z": round(z, 2),
            "best_link": best,
            "still_for_s": round(still_for),
            "position": pos,
            "zone": zone,
            "field": field,
            "rssi": self.links[best].v[-1] if self.links[best].v else None,
            "mean_rssi": round(feats[best]["mean"], 2) if feats[best]["mean"] is not None else None,
            "variance": round(feats[best]["sd"] ** 2, 3),
            "motion_band_power": round(min(30.0, z * 3), 3),
            "exercise": {**self._rhythm, "reps": reps_today, "current_set": self.cur and {"reps": self.cur["reps"], "since_s": round(now - self.cur["start"])}, "sets": self.sets[-10:]},
            "breathing": self._breath,
            "fall": self.fall,
            "interference": self.interference,
            "totals": {k: (round(v) if isinstance(v, float) else v) for k, v in self.totals.items()},
            "links": [
                {"id": k, "a": l.a, "b": l.b, "kind": l.kind, "rssi": l.v[-1] if l.v else None, "z": round(feats[k]["z"], 2),
                 "shift": round(feats[k]["shift"], 2), "sparse": feats[k]["sparse"], "live": k in live, "calibrated": l.base is not None}
                for k, l in self.links.items()
            ],
        }

    def _lying(self, now):
        return self.since["state"] == "still" and now - self.since["at"] >= 300

    # ---------------------------------------------------------- interference
    def _interference(self, now):
        noises = [l.extra.get("noise") for l in self.links.values() if l.extra.get("noise") is not None]
        if not noises:
            self.interference = False
            return
        n = max(noises)
        if now - getattr(self, "_noise_at", 0) >= 1.0:
            self._noise_at = now
            self._noise.append(n)
        floor = pctl(self._noise, 0.1) if len(self._noise) > 5 else n
        was = self.interference
        self.interference = n - floor >= 8
        if self.interference and not was:
            self.events.append({"at": now, "kind": "interference", "detail": "2.4 GHz noise jump (microwave oven, Bluetooth audio or a nearby AP); motion paused"})

    # ---------------------------------------------------------- rhythm + reps
    def _rhythm_step(self, now, best, moving):
        """Repetitive exercise done in place across one link. Guards against the v1 failure modes:
        hotspot level flicker (sparse steps), walking laps (motion hops between links) and
        noise (needs amplitude well above the link's empty-room noise and a clean 2nd period)."""
        self._best_hist.append(best)
        if now - self._eval_at < 0.5:
            return
        self._eval_at = now
        key = self.cur["link"] if self.cur else best
        link = self.links[key]
        raw = list(link.v)[-int(HZ * 12):]
        r, r2, lag, amp = 0.0, 0.0, None, 0.0
        if len(raw) >= HZ * 8:
            lp = moving_avg(raw, 4)
            trend = moving_avg(lp, int(HZ * 4))
            x = [a - b for a, b in zip(lp, trend)][int(HZ * 2):]  # drop the filter warm-up
            amp = pctl(x, 0.95) - pctl(x, 0.05)
            lag, r = autocorr_peak(x, int(HZ * 0.8), int(HZ * 4))
            if lag and 2 * lag < len(x) // 2 + lag:
                m = statistics.fmean(x)
                d = [v - m for v in x]
                var = sum(v * v for v in d) or 1e-9
                n2 = len(d) - 2 * lag
                r2 = sum(d[i] * d[i + 2 * lag] for i in range(n2)) / var * len(d) / max(1, n2) if n2 > 0 else 0.0
        sd0 = link.sd0 or 0.5
        hist = list(self._best_hist)[-int(HZ * 8):]
        dominance = hist.count(key) / max(1, len(hist))
        clean = not link.f["sparse"] and not self.interference
        strong = bool(lag) and clean and r >= 0.55 and r2 >= 0.25 and amp >= max(2.0, 4.0 * sd0) and dominance >= 0.75
        weak = bool(lag) and clean and r >= 0.3 and amp >= 0.5 * (self.cur or {}).get("amp", amp + 1)

        if not self.cur:
            if strong:
                self._lags.append(lag)
                self._cand_since = self._cand_since or now
            else:
                self._lags.clear()
                self._cand_since = None
            stable = len(self._lags) >= 3 and (max(self._lags) - min(self._lags)) <= 0.25 * statistics.median(self._lags)
            if strong and stable and now - self._cand_since >= 1.0:
                per = statistics.median(self._lags)
                # the rhythm needed ~2 periods + filter delay to show; start the set there
                self.cur = {"start": max(self._cand_since - 15.0, min(self._cand_since - 4.0, link.last_quiet)), "reps": 0, "link": key, "amp": amp, "per": per}
        else:
            if weak and lag:
                self._lost_at = None
                self.cur["per"] = 0.8 * self.cur["per"] + 0.2 * lag
            else:
                self._lost_at = self._lost_at or now
        if self.cur:
            per = self.cur["per"]
            span = now - self.cur["start"] - (now - self._lost_at if self._lost_at else 0.0)
            n = int(max(0.0, span) * HZ) + int(HZ * 0.5)
            end = len(link.v) - (int((now - self._lost_at) * HZ) if self._lost_at else 0)
            seg = list(link.v)[max(0, end - n):end]
            seg = [-v for v in moving_avg(seg, 4)]  # a body on the line makes the RSSI dip: count dips
            reps = count_peaks(seg, int(0.6 * per), max(1.0, 0.35 * self.cur["amp"]))
            self.cur["reps"] = max(self.cur["reps"], reps)
            self.cur["cadence"] = round(60 * HZ / per)
            if self._lost_at and now - self._lost_at > 4.0:
                if self.cur["reps"] >= 3:  # a real set
                    self.sets.append({"reps": self.cur["reps"], "cadence": self.cur["cadence"], "ended": round(now), "dur_s": round(self._lost_at - self.cur["start"])})
                self.cur, self._lost_at = None, None
                self._lags.clear()
                self._cand_since = None
        live = bool(self.cur) and not self._lost_at
        self._rhythm = {"periodic": live, "cadence_per_min": self.cur["cadence"] if live else None, "correlation": round(r, 2), "amplitude_db": round(amp, 1)}

    # ---------------------------------------------------------- breathing (experimental)
    def _breathing_step(self, now, live, still):
        if now - self._breath_at < 1.0:
            return
        self._breath_at = now
        if not still or self.interference:
            self._breath = {"bpm": None, "confidence": 0.0, "why": "lie or sit still near a link for 20 s"}
            return
        total = {}
        used = 0
        for k in live:
            v = list(self.links[k].v)[-int(HZ * 32):]
            if len(v) < HZ * 20 or statistics.pstdev(v) < 0.15:
                continue
            sp = spectrum(v, 0.12, 0.6, 0.01)
            mags = [m for _, m in sp]
            s = sum(mags) or 1.0
            prom = max(mags) / (statistics.median(mags) or 1e-9)
            # links that clearly see a rhythm get the say (a link far from the body is just noise)
            wgt = max(0.0, prom - 2.0) ** 2
            for f, m in sp:
                total[round(f, 2)] = total.get(round(f, 2), 0.0) + wgt * m / s
            used += 1 if wgt > 0 else 0
        if not total or not any(total.values()):
            self._breath = {"bpm": None, "confidence": 0.0, "why": "signal too steady to see breathing"}
            return
        f, peak = max(total.items(), key=lambda kv: kv[1])
        med = statistics.median(total.values()) or 1e-9
        prom = peak / med
        conf = max(0.0, min(0.9, (prom - 2.5) / 5.0))
        self._breath = {"bpm": round(f * 60, 1) if conf >= 0.4 else None, "confidence": round(conf, 2), "links": used, "why": None if conf >= 0.4 else "no clear breathing rhythm"}

    # ---------------------------------------------------------- fall (experimental)
    def _fall_step(self, now, best, z, coarse):
        if self.fall["active"]:
            if coarse == "moving" and now - self.fall["at"] > 20:
                self.fall = {"active": False, "at": self.fall["at"]}
            return
        # impact = a swing far bigger than this link's recent motion (walking ~4-8 dB, a body
        # dropping through the line ~15-25 dB within a second)
        l = self.links[best]
        f = l.f
        if f.get("p2p", 0) >= max(12.0, 2.2 * f.get("p2p_typ", 0)) and not self.interference and not self._rhythm["periodic"] and not self._impact:
            pre = list(l.v)[-int(HZ * 8):-int(HZ * 3)]
            self._impact = {"at": now, "link": best, "pre": statistics.fmean(pre) if pre else None}
        imp = self._impact
        if imp and now - imp["at"] > 25:
            self._impact = None
        elif imp and now - imp["at"] >= 10 and coarse == "still":
            l = self.links[imp["link"]]
            post = list(l.v)[-int(HZ * 5):]
            moved = imp["pre"] is not None and post and abs(statistics.fmean(post) - imp["pre"]) >= 2.0
            if moved:  # body now somewhere new on the floor, not moving
                self.fall = {"active": True, "at": now}
                self.events.append({"at": now, "kind": "fall", "detail": "Sudden large motion, then 10 s of stillness in a new spot"})
            self._impact = None

    # ---------------------------------------------------------- RTI-style location
    def _locate(self, live, zs, grid=(20, 15)):
        nodes = self.layout["nodes"]
        W, H = self.layout["room"]
        ws = []
        for k in live:
            l = self.links[k]
            if l.a in nodes and l.b in nodes:
                # motion near the line + body shadowing (mean drop vs the empty room)
                w = max(0.0, zs[k] - 1.6) + 0.3 * max(0.0, self.links[k].f["shift"] - 3.0)
                if self.cur and self.cur["link"] == k:
                    w += 3.0
                if w > 0:
                    ws.append((w, nodes[l.a], nodes[l.b]))
        if not ws:
            return None, None, None
        gx, gy = grid
        field = []
        best, bv = None, -1.0
        lam = 0.35
        for j in range(gy):
            for i in range(gx):
                p = ((i + 0.5) * W / gx, (j + 0.5) * H / gy)
                v = 0.0
                for w, a, b in ws:
                    L = math.dist(a, b)
                    excess = math.dist(p, a) + math.dist(p, b) - L  # ellipse model (Wilson & Patwari)
                    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    # one link alone can't say where along it you are: lean gently to its middle
                    v += w * math.exp(-((excess / lam) ** 2)) * (1 - 0.2 * min(1.0, (math.dist(p, mid) / (L / 2)) ** 2))
                field.append(v)
                if v > bv:
                    bv, best = v, p
        mx = max(field) or 1.0
        field = [round(v / mx, 3) for v in field]
        # zone = the link the motion is closest to
        zl = self.cur["link"] if self.cur else max(live, key=lambda k: zs[k] + 0.3 * max(0.0, self.links[k].f["shift"] - 3.0))
        return [round(best[0], 2), round(best[1], 2)], {"w": gx, "h": gy, "values": field}, f"near {self.links[zl].a}↔{self.links[zl].b}"


# ================================================================ HTTP API (RuView-compatible subset)
def make_handler(app):
    fu = app["fusion"]

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def authed(self):
            return self.headers.get("Authorization", "") == f"Bearer {app['token']}"

        def body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 2_000_000:
                return None
            try:
                return json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                return None

        def do_GET(self):
            path, _, qs = self.path.partition("?")
            path = path.rstrip("/")
            with app["lock"]:
                s = dict(fu.state)
            fresh = bool(s)
            if path in ("/health", "/health/live", "/health/ready"):
                return self.send(200, {"status": "ok", "source": "rssi", "version": VERSION, "tick": app["tick"], "links": len(s.get("links", [])), "processing": {"state": "live" if fresh else "stale"}})
            if not path.startswith("/api/v1/"):
                return self.send(404, {"error": "not found"})
            if not self.authed():
                return self.send(401, {"error": "missing or invalid bearer token"})
            nodes = [{"node_id": l["id"], "rssi_dbm": l["rssi"], "kind": l["kind"], "subcarrier_count": 0} for l in s.get("links", [])]
            if path == "/api/v1/sensing/latest":
                if not fresh:
                    return self.send(200, {"status": "no data yet"})
                pos = s.get("position")
                W, H = fu.layout["room"]
                return self.send(200, {
                    "type": "sensing_update", "timestamp": time.time(), "source": "rssi", "version": VERSION, "tick": app["tick"],
                    "nodes": nodes,
                    "features": {k: s.get(k) for k in ("mean_rssi", "variance", "motion_band_power")},
                    "classification": {"motion_level": s["motion_level"], "presence": s["presence"], "confidence": s["confidence"]},
                    "estimated_persons": 1 if s["presence"] else 0,
                    "activity": s["activity"], "zone": s["zone"], "still_for_s": s["still_for_s"],
                    # RuView's person position is metres from the room centre, [x, y(height), z]
                    "persons": [{"position": [pos[0] - W / 2, 0.0, pos[1] - H / 2]}] if pos and s["presence"] else [],
                    "signal_field": s["field"],
                    "exercise": s["exercise"],
                    "breathing": s["breathing"],
                    "interference": s["interference"],
                    "totals": s["totals"],
                    "links": s["links"],
                    "layout": fu.layout,
                    "capabilities": CAPABILITIES,
                })
            if path == "/api/v1/vital-signs":
                b = s.get("breathing") or {}
                if b.get("bpm"):
                    return self.send(200, {"authority": "rssi-experimental", "vital_signs": {"breathing_rate_bpm": b["bpm"], "breathing_confidence": b["confidence"], "heart_rate_bpm": None}})
                return self.send(200, {"authority": "abstained", "abstention_reason": b.get("why") or "RSSI: breathing needs stillness near a link; heart rate needs CSI", "vital_signs": {}})
            if path == "/api/v1/edge-vitals":
                f = s.get("fall") or {}
                return self.send(200, {"status": "experimental", "message": "RSSI fall detection is experimental", "edge_vitals": {"fall_detected": bool(f.get("active")), "presence": s.get("presence"), "n_persons": 1 if s.get("presence") else 0}})
            if path == "/api/v1/nodes":
                return self.send(200, {"total": len(nodes), "nodes": nodes})
            if path == "/api/v1/status":
                return self.send(200, {"source": "rssi", "version": VERSION, "iface": app.get("iface"), "gateway": app.get("gateway"), "events": list(fu.events)[-10:], "capabilities": CAPABILITIES})
            if path == "/api/v1/rssi/recent":
                m = re.search(r"seconds=(\d+)", qs)
                sec = min(300, int(m.group(1))) if m else 15
                with app["lock"]:
                    links = {k: list(l.v)[-int(HZ * sec):] for k, l in fu.links.items()}
                best = s.get("best_link")
                return self.send(200, {"hz": HZ, "links": links, "best": best, "rssi": links.get(best, []), "labels": list(fu.labels)})
            if path == "/api/v1/zones":
                return self.send(200, {"zones": []})
            if path == "/api/v1/layout":
                return self.send(200, fu.layout)
            return self.send(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0].rstrip("/")
            if not self.authed():
                return self.send(401, {"error": "missing or invalid bearer token"})
            b = self.body()
            if b is None:
                return self.send(400, {"error": "bad json"})
            now = time.time()
            with app["lock"]:
                if path == "/api/v1/links/ingest":
                    # {"node": "laptop", "links": [{"a","b","kind","values":[...], "extra":{}}]}
                    for item in b.get("links", [])[:8]:
                        l = fu.link(str(item.get("a"))[:24], str(item.get("b"))[:24], str(item.get("kind", "wifi"))[:8])
                        for v in item.get("values", [])[-int(HZ * 5):]:
                            if isinstance(v, (int, float)) and -120 < v < 0:
                                l.push(v, now, item.get("extra") or {})
                    return self.send(200, {"ok": True})
                if path == "/api/v1/calibrate/empty":
                    return self.send(200, {"calibrated": fu.calibrate_empty()})
                if path == "/api/v1/layout":
                    room = b.get("room")
                    nodes = b.get("nodes")
                    if isinstance(room, list) and len(room) == 2 and isinstance(nodes, dict):
                        fu.layout = {"room": [float(room[0]), float(room[1])], "nodes": {str(k)[:24]: [float(v[0]), float(v[1])] for k, v in nodes.items() if isinstance(v, list) and len(v) == 2}}
                    return self.send(200, fu.layout)
                if path == "/api/v1/label":
                    fu.labels.append({"at": now, "label": str(b.get("label", ""))[:32]})
                    return self.send(200, {"ok": True})
            return self.send(404, {"error": "not found"})

    return H


# ================================================================ modes
def serve(a):
    if not a.token:
        raise SystemExit("Set --token or RUVIEW_API_TOKEN")
    iface = a.iface or default_iface()
    gw = a.gateway or default_gateway()
    fusion = Fusion(a.inactivity)
    app = {"token": a.token, "iface": iface, "gateway": gw, "tick": 0, "fusion": fusion, "lock": threading.Lock()}
    world = SyntheticWorld() if a.source == "synthetic" else None
    wifi = WifiSampler(iface, gw, a.source)
    t0 = time.time()

    def loop():
        nxt = time.time()
        while True:
            now = time.time()
            with app["lock"]:
                if world:
                    for (x, y) in world.LINKS:
                        fusion.link(x, y, "ble" if "uno" in (x, y) and "laptop" in (x, y) else "wifi").push(world.rssi((x, y), now - t0), now)
                else:
                    v, ex = wifi.sample()
                    fusion.link(a.name, "ap", "wifi").push(v, now, ex)
                fusion.step(now)
                app["tick"] += 1
            nxt += 1 / HZ
            time.sleep(max(0, nxt - time.time()))

    threading.Thread(target=loop, daemon=True).start()
    print(f"FitMax sensing v{VERSION} on :{a.port}  node={a.name} iface={iface} gateway={gw} source={a.source}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", a.port), make_handler(app)).serve_forever()


def agent(a):
    """Laptop side: sample this device's links at 10 Hz and push them to the hub every 0.5 s."""
    if not a.token or not a.hub:
        raise SystemExit("agent needs --hub http://<board-ip>:3000 and --token")
    iface = a.iface or default_iface()
    gw = a.gateway or default_gateway()
    wifi = WifiSampler(iface, gw, a.source)
    ble = BleSampler(a.ble_peer) if a.ble_peer else None
    if ble and ble.error:
        print(ble.error, file=sys.stderr)
    buf = {"wifi": [], "ble": []}
    extra = {}
    url = a.hub.rstrip("/") + "/api/v1/links/ingest"
    print(f"FitMax agent '{a.name}' → {a.hub}  iface={iface}{'  ble=' + a.ble_peer if ble else ''}", flush=True)
    nxt, sent_at, fails = time.time(), time.time(), 0
    while True:
        v, ex = wifi.sample()
        if v is not None:
            buf["wifi"].append(v)
            extra = ex
        if ble:
            b = ble.sample()
            if b is not None:
                buf["ble"].append(b)
        now = time.time()
        if now - sent_at >= 0.5:
            links = [{"a": a.name, "b": "ap", "kind": "wifi", "values": buf["wifi"], "extra": extra}]
            if ble:
                links.append({"a": a.name, "b": a.ble_name, "kind": "ble", "values": buf["ble"]})
            req = urllib.request.Request(url, data=json.dumps({"node": a.name, "links": links}).encode(), headers={"Content-Type": "application/json", "Authorization": f"Bearer {a.token}"})
            try:
                urllib.request.urlopen(req, timeout=2).read()
                if fails:
                    print("reconnected", flush=True)
                fails = 0
            except Exception as e:
                fails += 1
                if fails in (1, 10) or fails % 100 == 0:
                    print(f"push failed ({e}); retrying", file=sys.stderr, flush=True)
            buf = {"wifi": [], "ble": []}
            sent_at = now
        nxt += 1 / HZ
        time.sleep(max(0, nxt - time.time()))


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0].startswith("-"):
        argv = ["serve"] + argv  # v1 command line still works
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    for name in ("serve", "agent"):
        p = sub.add_parser(name)
        p.add_argument("--token", default=os.environ.get("RUVIEW_API_TOKEN", ""))
        p.add_argument("--iface", default=None)
        p.add_argument("--gateway", default=None, help="ping target (default: router)")
        p.add_argument("--source", choices=["auto", "iw", "proc", "synthetic"], default="auto")
        p.add_argument("--name", default="uno" if name == "serve" else "laptop", help="this device's node name")
    sub.choices["serve"].add_argument("--port", type=int, default=3000)
    sub.choices["serve"].add_argument("--inactivity", type=int, default=600, help="seconds without motion before 'absent'")
    sub.choices["agent"].add_argument("--hub", default=os.environ.get("FITMAX_HUB", ""))
    sub.choices["agent"].add_argument("--ble-peer", default=None, help="Bluetooth address of the UNO Q to measure (optional)")
    sub.choices["agent"].add_argument("--ble-name", default="uno")
    a = ap.parse_args(argv)
    (serve if a.mode == "serve" else agent)(a)


if __name__ == "__main__":
    main()
