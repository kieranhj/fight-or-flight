"""Score our reception against adsb.lol: what share of the aircraft it saw near us did we hear?

Built to be gentle on adsb.lol. The Worker's recorder was rate-limited (HTTP 429) at
4 requests/minute (docs/RECORDING-PAUSE.md), so this:
  - makes ONE point query per interval, default every 2 minutes and never more often than
    every 60 s, from this process only (the browser never calls adsb.lol);
  - never retries: any failure (429, 403, timeout, bad JSON) doubles the wait, up to an
    hour, and a Retry-After header is respected if it asks for longer;
  - goes back to the normal interval only after a successful query.

Scores accumulate in labelled sessions (e.g. "window", "loft") so antenna positions can be
compared fairly however busy the sky is. Finished sessions are appended to
captures/compare-sessions.jsonl so they survive restarts.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import TYPE_CHECKING

from adsb_local import bearing_deg, distance_km

if TYPE_CHECKING:
    from adsb_local import Decoder

API = "https://api.adsb.lol/v2/point/{lat:.4f}/{lon:.4f}/{radius}"
USER_AGENT = "fight-or-flight-receiver-test/0.1 (+https://github.com/kieranhj/fight-or-flight)"
MIN_INTERVAL_S = 60
MAX_BACKOFF_S = 3600
RADIUS_NM = 30

SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
BANDS = [("<3k", 0, 3000), ("3–10k", 3000, 10000), ("10–20k", 10000, 20000), (">20k", 20000, 10**6)]
HEARD_WINDOW_S = 60  # we count an aircraft as heard if we decoded anything from it this recently
# Their aircraft we couldn't hear even in principle: TIS-B/ADS-R rebroadcasts and ADS-C
# (satellite) aren't on 1090 MHz from the aircraft itself.
UNHEARABLE_TYPES = ("tisb", "adsr", "adsc", "other")


def _empty_grid() -> dict:
    return {s: {b[0]: [0, 0] for b in BANDS} for s in SECTORS}  # [heard, expected]


class Comparator:
    def __init__(self, decoder: "Decoder", interval_s: float, sessions_path: Path):
        self.decoder = decoder
        self.interval_s = max(interval_s, MIN_INTERVAL_S)
        self.sessions_path = sessions_path
        self.lock = threading.Lock()
        self.wait_s = self.interval_s
        # Let the receiver listen for a full heard-window first, or the first score is unfairly low.
        self.next_at = time.time() + HEARD_WINDOW_S + 5
        self.last_ok_at: float | None = None
        self.last_error: str | None = None
        self.requests = 0
        self.failures = 0
        self.last_sample: list[dict] = []
        self._new_session("first run")

    # -- sessions
    def _new_session(self, label: str) -> None:
        self.session = {"label": label, "started": time.time(), "samples": 0, "grid": _empty_grid()}

    def reset(self, label: str) -> None:
        with self.lock:
            if self.session["samples"]:
                done = dict(self.session, ended=time.time(), summary=self._summary(self.session["grid"]))
                with self.sessions_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(done) + "\n")
            self._new_session(label.strip()[:40] or "untitled")

    def past_sessions(self) -> list[dict]:
        if not self.sessions_path.exists():
            return []
        rows = []
        for line in self.sessions_path.read_text(encoding="utf-8").splitlines()[-20:]:
            try:
                s = json.loads(line)
            except ValueError:
                continue
            rows.append({k: s[k] for k in ("label", "started", "ended", "samples", "summary")})
        return rows

    @staticmethod
    def _summary(grid: dict) -> dict:
        def pct(cells):
            heard = sum(c[0] for c in cells)
            expected = sum(c[1] for c in cells)
            return {"heard": heard, "expected": expected,
                    "pct": round(100 * heard / expected) if expected else None}
        out = {"all": pct([c for s in grid.values() for c in s.values()])}
        for s in SECTORS:
            out[s] = pct(list(grid[s].values()))
        for b in BANDS:
            out[b[0]] = pct([grid[s][b[0]] for s in SECTORS])
        return out

    # -- polling
    def run(self) -> None:
        while True:
            time.sleep(max(0.0, self.next_at - time.time()))
            self._poll_once()

    def _poll_once(self) -> None:
        lat, lon = self.decoder.receiver
        url = API.format(lat=lat, lon=lon, radius=RADIUS_NM)
        self.requests += 1
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                theirs = json.load(resp).get("ac", [])
        except urllib.error.HTTPError as e:
            retry_after = e.headers.get("Retry-After", "")
            self._fail(f"HTTP {e.code}", int(retry_after) if retry_after.isdigit() else 0)
            return
        except (OSError, ValueError) as e:
            self._fail(type(e).__name__, 0)
            return
        self._score(theirs)
        self.failures = 0
        self.last_error = None
        self.last_ok_at = time.time()
        self.wait_s = self.interval_s
        self.next_at = time.time() + self.wait_s

    def _fail(self, reason: str, retry_after_s: int) -> None:
        self.failures += 1
        self.last_error = reason
        self.wait_s = min(max(self.wait_s * 2, retry_after_s), MAX_BACKOFF_S)
        self.next_at = time.time() + self.wait_s
        print(f"adsb.lol compare: {reason}; backing off {self.wait_s:.0f} s", flush=True)

    def _score(self, theirs: list[dict]) -> None:
        now = time.time()
        recv = self.decoder.receiver
        with self.decoder.lock:
            heard = {icao.lower() for icao, a in self.decoder.aircraft.items()
                     if now - a.last_seen <= HEARD_WINDOW_S}
        sample = []
        with self.lock:
            grid = self.session["grid"]
            for a in theirs:
                alt = a.get("alt_baro")
                hexid = a.get("hex", "")
                if (not isinstance(alt, (int, float)) or a.get("lat") is None or hexid.startswith("~")
                        or a.get("seen", 99) > 10 or str(a.get("type", "")).startswith(UNHEARABLE_TYPES)):
                    continue  # on the ground, no position, stale, or not hearable directly
                pos = (a["lat"], a["lon"])
                rng_nm = distance_km(recv, pos) / 1.852
                if rng_nm > RADIUS_NM:
                    continue
                sector = SECTORS[int(((bearing_deg(recv, pos) + 22.5) % 360) // 45)]
                band = next(b[0] for b in BANDS if b[1] <= alt < b[2])
                got = hexid.lower() in heard
                cell = grid[sector][band]
                cell[0] += got
                cell[1] += 1
                sample.append({"hex": hexid, "flight": (a.get("flight") or "").strip(), "alt": alt,
                               "r_nm": round(rng_nm, 1), "sector": sector, "heard": got})
            self.session["samples"] += 1
            self.last_sample = sorted(sample, key=lambda s: (s["heard"], s["r_nm"]))

    # -- output
    def snapshot(self) -> dict:
        now = time.time()
        with self.lock:
            s = self.session
            return {
                "session": {"label": s["label"], "started": s["started"], "samples": s["samples"],
                            "grid": s["grid"], "summary": self._summary(s["grid"])},
                "sectors": SECTORS, "bands": [b[0] for b in BANDS],
                "last_sample": self.last_sample,
                "past": self.past_sessions(),
                "status": {"interval_s": self.interval_s, "next_in_s": round(max(0, self.next_at - now)),
                           "last_ok_age_s": round(now - self.last_ok_at) if self.last_ok_at else None,
                           "last_error": self.last_error, "failures": self.failures,
                           "requests": self.requests, "radius_nm": RADIUS_NM},
            }
