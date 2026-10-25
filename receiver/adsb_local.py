"""Local ADS-B test receiver: rtl_adsb.exe -> Mode S decode -> local web page.

Runs rtl_adsb (from the RTL-SDR Blog Windows release) as a child process, reads
the raw hex frames it prints, CRC-checks and decodes them, and serves the
aircraft table at http://localhost:8090 plus /data/aircraft.json in the same
shape dump1090/readsb produce. That way the page (or anything else) can later
point at a real readsb/tar1090 install on a Raspberry Pi with no changes.

Standard library only. Usage:
    python receiver/adsb_local.py                       # live, from the dongle
    python receiver/adsb_local.py --gain 40             # fixed gain (dB), instead of AGC
    python receiver/adsb_local.py --lat 51.28 --lon -0.77
    python receiver/adsb_local.py --replay receiver/captures/first-30s.txt

The receiver location defaults to receiver/station.json ({"lat": .., "lon": ..}), which is
git-ignored so the antenna's exact position never lands in the public repo; failing that, EGLF.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import threading
import time
from collections import Counter, deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Farnborough (EGLF) aerodrome reference point, same as src/config/airports.ts.
EGLF = (51.2758, -0.7763)

# ---------------------------------------------------------------- Mode S basics

CRC_GENERATOR = 0x1FFF409  # 24-bit Mode S parity polynomial, with its top bit
CALLSIGN_CHARS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######"
MAX_RANGE_KM = 450  # anything further is a bad decode, not a real reception


def crc_remainder(data: int, nbits: int) -> int:
    """Run the Mode S CRC over the whole frame; 0 for a clean DF11/17/18."""
    for i in range(nbits - 24):
        if data & (1 << (nbits - 1 - i)):
            data ^= CRC_GENERATOR << (nbits - 25 - i)
    return data & 0xFFFFFF


def altitude_ac13(ac: int) -> int | None:
    """13-bit altitude code (DF0/4/16/20). Only the 25 ft encoding (Q=1) is handled."""
    m_bit, q_bit = (ac >> 6) & 1, (ac >> 4) & 1
    if ac == 0 or m_bit or not q_bit:
        return None
    n = ((ac & 0x1F80) >> 2) | ((ac & 0x0020) >> 1) | (ac & 0x000F)
    return n * 25 - 1000


def altitude_ac12(ac: int) -> int | None:
    """12-bit altitude code in an airborne position message (the M bit is absent)."""
    if ac == 0 or not (ac >> 4) & 1:
        return None
    n = ((ac >> 5) << 4) | (ac & 0xF)
    return n * 25 - 1000


def squawk_id13(id13: int) -> str:
    """13-bit identity code (DF5/21), Gillham bit order C1 A1 C2 A2 C4 A4 X B1 D1 B2 D2 B4 D4."""
    bit = lambda n: (id13 >> n) & 1  # noqa: E731
    a = bit(7) * 4 + bit(9) * 2 + bit(11)
    b = bit(1) * 4 + bit(3) * 2 + bit(5)
    c = bit(8) * 4 + bit(10) * 2 + bit(12)
    d = bit(0) * 4 + bit(2) * 2 + bit(4)
    return f"{a}{b}{c}{d}"


# ---------------------------------------------------------------- CPR positions

def cpr_nl(lat: float) -> int:
    """Number of longitude zones at a latitude (ICAO Annex 10 NL function)."""
    if lat == 0:
        return 59
    if abs(lat) >= 87:
        return 2 if abs(lat) == 87 else 1
    a = 1 - math.cos(math.pi / 30)
    b = math.cos(math.pi / 180 * abs(lat)) ** 2
    return int(math.floor(2 * math.pi / math.acos(1 - a / b)))


def cpr_global(even: tuple[int, int], odd: tuple[int, int], newest_odd: bool):
    """Decode an even/odd CPR pair into (lat, lon), or None if they straddle a zone edge."""
    lat_e, lon_e = even[0] / 131072, even[1] / 131072
    lat_o, lon_o = odd[0] / 131072, odd[1] / 131072
    j = math.floor(59 * lat_e - 60 * lat_o + 0.5)
    rlat_e = 360 / 60 * (j % 60 + lat_e)
    rlat_o = 360 / 59 * (j % 59 + lat_o)
    if rlat_e >= 270:
        rlat_e -= 360
    if rlat_o >= 270:
        rlat_o -= 360
    if cpr_nl(rlat_e) != cpr_nl(rlat_o):
        return None
    lat = rlat_o if newest_odd else rlat_e
    nl = cpr_nl(lat)
    ni = max(nl - (1 if newest_odd else 0), 1)
    m = math.floor(lon_e * (nl - 1) - lon_o * nl + 0.5)
    lon = 360 / ni * (m % ni + (lon_o if newest_odd else lon_e))
    if lon >= 180:
        lon -= 360
    return lat, lon


def cpr_local(cpr: tuple[int, int], odd: bool, ref: tuple[float, float]):
    """Decode one CPR message against a nearby reference (valid within ~180 NM)."""
    lat_c, lon_c = cpr[0] / 131072, cpr[1] / 131072
    dlat = 360 / (59 if odd else 60)
    j = math.floor(ref[0] / dlat) + math.floor(0.5 + (ref[0] % dlat) / dlat - lat_c)
    lat = dlat * (j + lat_c)
    ni = cpr_nl(lat) - (1 if odd else 0)
    dlon = 360 / ni if ni > 0 else 360
    m = math.floor(ref[1] / dlon) + math.floor(0.5 + (ref[1] % dlon) / dlon - lon_c)
    return lat, dlon * (m + lon_c)


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def bearing_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.degrees(math.atan2(y, x)) % 360


# ---------------------------------------------------------------- aircraft state

class Aircraft:
    def __init__(self, icao: str):
        self.icao = icao
        self.flight: str | None = None
        self.category: str | None = None
        self.alt_baro: int | None = None
        self.alt_geom: int | None = None
        self.gs: float | None = None
        self.track: float | None = None
        self.heading: float | None = None
        self.baro_rate: int | None = None
        self.squawk: str | None = None
        self.lat: float | None = None
        self.lon: float | None = None
        self.messages = 0
        self.first_seen = self.last_seen = time.time()
        self.last_pos_time = 0.0
        self.cpr: dict[bool, tuple[int, int, float]] = {}  # odd? -> (lat_cpr, lon_cpr, t)
        self.trail: deque[tuple[float, float, int | None]] = deque(maxlen=200)

    def to_json(self, now: float, receiver: tuple[float, float]) -> dict:
        out: dict = {"hex": self.icao.lower(), "messages": self.messages,
                     "seen": round(now - self.last_seen, 1)}
        for key in ("flight", "category", "alt_baro", "alt_geom", "gs", "track",
                    "heading", "baro_rate", "squawk"):
            value = getattr(self, key)
            if value is not None:
                out[key] = value
        if self.lat is not None and self.lon is not None:
            out.update(lat=round(self.lat, 5), lon=round(self.lon, 5),
                       seen_pos=round(now - self.last_pos_time, 1),
                       r_nm=round(distance_km(receiver, (self.lat, self.lon)) / 1.852, 1),
                       trail=[[round(la, 5), round(lo, 5), alt] for la, lo, alt in self.trail])
        return out


class Decoder:
    def __init__(self, receiver: tuple[float, float]):
        self.receiver = receiver
        self.aircraft: dict[str, Aircraft] = {}
        self.lock = threading.Lock()
        self.started = time.time()
        self.stats = Counter()
        self.df_counts = Counter()
        self.recent_good: deque[float] = deque()
        self.max_range_km = 0.0
        # Furthest fix per 10-degree bearing sector from the receiver: the coverage outline.
        self.outline: dict[int, tuple[float, float, float]] = {}

    # -- frame entry point
    def feed_line(self, line: str) -> None:
        line = line.strip()
        if not (line.startswith("*") and line.endswith(";")):
            return
        hexstr = line[1:-1]
        if len(hexstr) not in (14, 28):
            return
        self.stats["frames"] += 1
        try:
            data = int(hexstr, 16)
        except ValueError:
            return
        with self.lock:
            if self.handle(data, len(hexstr) * 4):
                self.stats["good"] += 1
                now = time.time()
                self.recent_good.append(now)
                while self.recent_good and now - self.recent_good[0] > 10:
                    self.recent_good.popleft()

    def handle(self, data: int, nbits: int) -> bool:
        df = data >> (nbits - 5)
        if df > 24:
            df = 24
        rem = crc_remainder(data, nbits)

        if df in (17, 18):
            if nbits != 112 or rem != 0:
                return self._bad()
            icao = f"{(data >> 80) & 0xFFFFFF:06X}"
            ac = self._get(icao, create=True)
            self._extended_squitter(ac, (data >> 24) & ((1 << 56) - 1), df)
        elif df == 11:
            if rem & ~0x7F:  # parity may be overlaid with a 7-bit interrogator ID
                return self._bad()
            self._get(f"{(data >> (nbits - 32)) & 0xFFFFFF:06X}", create=True)
        elif df in (0, 4, 5, 16, 20, 21):
            # Address/parity: the remainder *is* the ICAO address. Only trust it for
            # aircraft we already know from a clean DF11/17, otherwise noise makes ghosts.
            ac = self._get(f"{rem:06X}", create=False)
            if ac is None:
                return self._bad()
            field13 = (data >> (nbits - 32)) & 0x1FFF
            if df in (0, 4, 16, 20):
                alt = altitude_ac13(field13)
                if alt is not None:
                    ac.alt_baro = alt
            else:
                ac.squawk = squawk_id13(field13)
        else:
            return self._bad()

        self.df_counts[df] += 1
        return True

    def _bad(self) -> bool:
        self.stats["bad_crc"] += 1
        return False

    def _get(self, icao: str, create: bool) -> Aircraft | None:
        ac = self.aircraft.get(icao)
        if ac is None:
            if not create:
                return None
            ac = self.aircraft[icao] = Aircraft(icao)
        ac.messages += 1
        ac.last_seen = time.time()
        return ac

    def _extended_squitter(self, ac: Aircraft, me: int, df: int) -> None:
        tc = me >> 51
        if 1 <= tc <= 4:
            chars = "".join(CALLSIGN_CHARS[(me >> (42 - 6 * i)) & 0x3F] for i in range(8))
            ac.flight = chars.replace("#", "").strip() or None
            ac.category = f"{'DCBA'[tc - 1]}{(me >> 48) & 7}"
        elif 9 <= tc <= 18 or 20 <= tc <= 22:
            alt12 = (me >> 36) & 0xFFF
            if tc <= 18:
                alt = altitude_ac12(alt12)
                if alt is not None:
                    ac.alt_baro = alt
            elif alt12:
                ac.alt_geom = round(alt12 * 3.28084)  # GNSS height is in metres
            self._position(ac, bool((me >> 34) & 1), (me >> 17) & 0x1FFFF, me & 0x1FFFF)
        elif tc == 19:
            self._velocity(ac, me)

    def _position(self, ac: Aircraft, odd: bool, lat_cpr: int, lon_cpr: int) -> None:
        now = time.time()
        ac.cpr[odd] = (lat_cpr, lon_cpr, now)
        pos = None
        if ac.lat is not None and now - ac.last_pos_time < 60:
            pos = cpr_local((lat_cpr, lon_cpr), odd, (ac.lat, ac.lon))
            # A local decode against a stale/wrong reference shows up as a jump.
            if distance_km(pos, (ac.lat, ac.lon)) > 15:
                pos = None
        if pos is None and False in ac.cpr and True in ac.cpr:
            even, oddm = ac.cpr[False], ac.cpr[True]
            if abs(even[2] - oddm[2]) <= 10:
                pos = cpr_global(even[:2], oddm[:2], newest_odd=odd)
        if pos is None:
            return
        rng = distance_km(self.receiver, pos)
        if rng > MAX_RANGE_KM:
            self.stats["rejected_pos"] += 1
            return
        self.max_range_km = max(self.max_range_km, rng)
        sector = int(bearing_deg(self.receiver, pos) // 10)
        if rng > self.outline.get(sector, (0.0,))[0]:
            self.outline[sector] = (rng, *pos)
        ac.lat, ac.lon = pos
        ac.last_pos_time = now
        ac.trail.append((pos[0], pos[1], ac.alt_baro))

    def _velocity(self, ac: Aircraft, me: int) -> None:
        st = (me >> 48) & 7
        if st in (1, 2):
            v_ew, v_ns = (me >> 32) & 0x3FF, (me >> 21) & 0x3FF
            if v_ew and v_ns:
                scale = 4 if st == 2 else 1
                vx = (v_ew - 1) * scale * (-1 if (me >> 42) & 1 else 1)
                vy = (v_ns - 1) * scale * (-1 if (me >> 31) & 1 else 1)
                ac.gs = round(math.hypot(vx, vy), 1)
                ac.track = round(math.degrees(math.atan2(vx, vy)) % 360, 1)
        elif st in (3, 4) and (me >> 42) & 1:
            ac.heading = round(((me >> 32) & 0x3FF) * 360 / 1024, 1)
        vr = (me >> 10) & 0x1FF
        if vr:
            ac.baro_rate = (vr - 1) * 64 * (-1 if (me >> 19) & 1 else 1)

    # -- output
    def snapshot(self) -> dict:
        now = time.time()
        with self.lock:
            for icao in [k for k, a in self.aircraft.items() if now - a.last_seen > 300]:
                del self.aircraft[icao]
            aircraft = [a.to_json(now, self.receiver) for a in self.aircraft.values()]
            return {
                "now": now,
                "messages": self.stats["good"],
                "aircraft": sorted(aircraft, key=lambda a: (a["seen"] > 60, a.get("r_nm", 9e9))),
                "stats": {
                    "uptime_s": round(now - self.started),
                    "frames": self.stats["frames"],
                    "good": self.stats["good"],
                    "bad_crc": self.stats["bad_crc"],
                    "rejected_pos": self.stats["rejected_pos"],
                    "good_per_s": round(len(self.recent_good) / 10, 1),
                    "max_range_nm": round(self.max_range_km / 1.852, 1),
                    "df": {str(k): v for k, v in sorted(self.df_counts.items())},
                },
                "receiver": {"lat": self.receiver[0], "lon": self.receiver[1]},
                "outline": [[round(la, 4), round(lo, 4)] for _, (_, la, lo) in sorted(self.outline.items())],
                "sectors_nm": {str(k * 10): round(v[0] / 1.852, 1) for k, v in sorted(self.outline.items())},
            }


# ---------------------------------------------------------------- inputs

def run_rtl_adsb(decoder: Decoder, exe: Path, gain: float | None, save: Path | None) -> None:
    cmd = [str(exe)]
    if gain is not None:
        cmd += ["-g", str(gain)]
    print("Starting:", " ".join(cmd), flush=True)
    proc = subprocess.Popen(cmd, cwd=exe.parent, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1)
    log = save.open("a", encoding="ascii") if save else None
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if line.startswith("*"):
                decoder.feed_line(line)
                if log:
                    log.write(line)
            else:
                print("rtl_adsb:", line.rstrip(), flush=True)
    finally:
        if log:
            log.close()
        proc.terminate()
    print(f"rtl_adsb exited (code {proc.wait()}). Is the dongle plugged in and not "
          "in use by another program (SDR#, SDR++)?", flush=True)


def run_replay(decoder: Decoder, path: Path, rate: float) -> None:
    lines = path.read_text(encoding="ascii", errors="ignore").splitlines()
    print(f"Replaying {len(lines)} frames from {path} at {rate:g}/s", flush=True)
    for line in lines:
        decoder.feed_line(line)
        time.sleep(1 / rate)
    print("Replay finished; the page keeps showing the final state.", flush=True)


# ---------------------------------------------------------------- web server

def make_handler(decoder: Decoder):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(HERE / "web"), **kwargs)

        def do_GET(self):
            if self.path.split("?")[0] == "/data/aircraft.json":
                body = json.dumps(decoder.snapshot()).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

        def log_message(self, *args):
            pass

    return Handler


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lat", type=float, default=EGLF[0], help="receiver latitude (default: EGLF)")
    p.add_argument("--lon", type=float, default=EGLF[1], help="receiver longitude (default: EGLF)")
    p.add_argument("--gain", type=float, help="tuner gain in dB (default: automatic)")
    p.add_argument("--port", type=int, default=8090)
    p.add_argument("--rtl-adsb", type=Path, default=HERE / "bin" / "rtl_adsb.exe")
    p.add_argument("--save", type=Path, help="append raw frames to this file for later replay")
    p.add_argument("--replay", type=Path, help="decode a saved capture instead of the dongle")
    p.add_argument("--rate", type=float, default=15, help="replay speed, frames per second")
    args = p.parse_args()
    station = HERE / "station.json"
    if station.exists() and args.lat == EGLF[0] and args.lon == EGLF[1]:
        loc = json.loads(station.read_text())
        args.lat, args.lon = float(loc["lat"]), float(loc["lon"])
    print(f"Receiver location {args.lat:.5f}, {args.lon:.5f}", flush=True)

    decoder = Decoder((args.lat, args.lon))
    if args.replay:
        source = threading.Thread(target=run_replay, args=(decoder, args.replay, args.rate), daemon=True)
    else:
        if not args.rtl_adsb.exists():
            sys.exit(f"rtl_adsb not found at {args.rtl_adsb} - see receiver/README.md")
        source = threading.Thread(target=run_rtl_adsb, daemon=True,
                                  args=(decoder, args.rtl_adsb, args.gain, args.save))
    source.start()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(decoder))
    print(f"Open http://localhost:{args.port}  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
