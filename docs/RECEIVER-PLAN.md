# Own ADS-B Receiver — Hardware Plan
*Build our own 1090 MHz ADS-B receiver near Farnborough (EGLF), feed it to the community
aggregators, and eventually use it as a first-hand data source for Fight or Flight.*

> **Status (26 Oct 2026):** R0 (laptop proof of reception) ✅ and R1's indoor siting tests ✅
> are done. **R3: a Raspberry Pi 3B+ running the adsb.im image is decoding**, and **R4: it is
> feeding adsb.lol, airplanes.live and adsb.fi** with the privacy flag on. Next: PoE power and a
> high bathroom placement, the 1090MHz UK key, then an outdoor antenna or another site with a
> view north. The laptop test receiver is in [`../receiver/`](../receiver/README.md).

---

## 1. Goal and why it matters to this project

- **Short term:** prove we can receive and decode 1090 MHz Mode S / ADS-B from a laptop, and
  learn what limits reception (antenna, gain, location, software).
- **Medium term:** a Raspberry Pi receiver running full time, **feeding airplanes.live and
  adsb.lol**. These are the two feeds the Worker already reads (`worker/src/index.ts`).
- **Long term:** the Worker reads our own receiver for local traffic and falls back to the
  aggregators. A receiver close to Farnborough sees the low-level arrivals, departures and
  circuits, which are the flights complaints are about. Receivers further away can lose these
  below their radio horizon.

---

## 2. Hardware we have

| Item | Notes |
|---|---|
| **RTL-SDR Blog V3** (RTL2832U + Rafael Micro R820T tuner) | Fine for 1090 MHz. Has a TCXO (stable frequency), a software-switchable 4.5 V bias tee on the coax (to power an amplifier), and direct sampling for HF (not needed here). Shows up in Windows as `RTL2838UHIDIR`, `USB\VID_0BDA&PID_2838`. |
| **Driver** | WinUSB, installed with Zadig. No firmware flashing is needed on a V3; Zadig only swaps the Windows driver. |
| **Stock antenna** | The telescopic dipole kit. Workable for a first test, but not tuned for 1090 MHz. |
| **Laptop** | Windows 11, Python 3.13. WSL is not installed (and not needed for R0). |
| **Raspberry Pi 3 Model B+** | Runs the adsb.im image at `adsb-feeder.local` (see R3). Has a PoE header and built-in Wi-Fi. |
| **PoE switch** | Existing. Check it is 802.3af/at (standard PoE) before connecting the Pi; see R3. |

---

## 3. Phase R0 findings (laptop, 25 Oct 2026) ✅

### Software that works on current Windows
- The **RTL-SDR Blog driver release V1.4.0** (Aug 2026,
  <https://github.com/rtlsdrblog/rtl-sdr-blog/releases>) is current and maintained. Its
  `Release.zip` → `x64/` holds `rtl_test`, `rtl_adsb`, `rtl_fm`, `rtl_tcp`, `rtl_biast`,
  `rtl_eeprom` and the DLLs. They work with the WinUSB driver as installed. The older Windows
  ADS-B tools (old dump1090 Windows ports, ADSB# for SDR#) are not needed.
- `rtl_test -s 2000000`: tuner detected and **no lost samples** at 2 MS/s, so USB is healthy.
  Its "Enabled direct sampling mode" line is expected: this driver switches to HF direct
  sampling when no frequency is set.

### Test receiver we built (`receiver/`)
```
dongle → bin/rtl_adsb.exe → adsb_local.py (CRC check + decode) → http://localhost:8090
                                 └→ /data/aircraft.json (dump1090/readsb layout)
```
- `receiver/adsb_local.py` uses only the Python standard library. It CRC-checks each frame, then
  decodes DF17/18 extended squitter (callsign and emitter category, airborne position via CPR
  global and local decode, barometric and GNSS altitude, ground speed, track, vertical rate).
  It also decodes DF4/20 altitude and DF5/21 squawk replies, accepted only for aircraft already
  seen in a clean DF11/17, so noise can't create ghost aircraft. Positions further than 450 km
  from the receiver are rejected.
- Its output was checked against the published test vectors in *The 1090 MHz Riddle*
  (KLM1023; 52.2572 N, 3.91937 E at 38,000 ft; 159.2 kt, track 182.9°, −832 ft/min). All match.
- `receiver/web/index.html`: Leaflet map with the receiver, EGLF, range rings at
  10/25/50/100 NM, aircraft symbols pointing along track, trails, and a table. It polls
  `data/aircraft.json` every second.
- Options: `--lat/--lon` (receiver location, defaults to EGLF), `--gain`, `--save` (record
  raw frames), and `--replay` (decode a saved capture with no dongle attached).
- **Because the JSON uses the dump1090/readsb layout, the page (and later the Worker) can point
  at a Pi running readsb with no changes.**

### Measured results (stock antenna, indoors, automatic gain)
| Run | Frames from `rtl_adsb` | Passed CRC | Good msgs/s | Max range | Notes |
|---|---|---|---|---|---|
| First 30 s | 378 | 60 (16%) | ~6 | 28.5 NM | 3 aircraft, 1 with position (FL330, 28.5 NM south) |
| 90 s live | 1,030 | 318 (31%) | ~5 | 12.2 NM | TAP783 FL370 at 9.6 NM, RYR40JD descending FL190 at 11.2 NM |
| ~3.1 h live | 35,174 | 11,499 (33%) | ~4–5 | **40.2 NM** | 0 positions rejected as implausible |

Mix of good messages over the long run: DF17 4,082, DF20 4,932, DF21 1,855, DF16 630.

### Coverage by direction: the building blocks the north
The antenna is indoors at a **south-facing window, with most of the building to its north**.
The site is about **4.8 NM south of EGLF, so Farnborough is at about 003°, almost due north**.
Heathrow is about 21 NM at about 035°. *(The exact coordinates are kept in the git-ignored
`receiver/station.json`, not here, because this repo is public.)*

Replaying the 3.1-hour capture and binning every position fix by bearing from the antenna:

| Sector | Position fixes | Aircraft | Max range NM | Median alt ft | Lowest alt ft |
|---|---|---|---|---|---|
| N | 11 | 2 | 8.0 | 19,000 | 18,000 |
| NE | 76 | 9 | 15.4 | 33,000 | 3,975 |
| E | 469 | 23 | 17.2 | 19,000 | 8,975 |
| SE | 157 | 18 | 17.8 | 19,000 | 9,575 |
| S | 195 | 11 | **35.6** | 18,500 | 10,125 |
| SW | 120 | 11 | 19.8 | 31,800 | 15,000 |
| W | 112 | 14 | 16.1 | 19,000 | 3,725 |
| NW | 31 | 4 | 6.9 | 17,625 | 14,225 |

- North is almost blank: 11 fixes, nothing below 18,000 ft, nothing beyond 8 NM. Only aircraft
  high enough to be seen over the building get through.
- **In 3 hours, nothing below about 3,700 ft was decoded from any direction.** Farnborough
  arrivals, departures and circuits are below that, so **this site cannot yet see the traffic
  the app is about.** The overnight run, below, lowered that to about 3,000 ft, but no further.
- Cross-check (25 Oct, about 22:40): at a quiet time, 34 aircraft were airborne within 60 NM on
  adsb.lol. Most were in the Heathrow flow to the N/NE, including arrivals at 125–1,800 ft at
  about 21 NM, and we decoded none of those. Flightradar24 showed the same. RYR66PG, climbing
  out SSE past us, was barely heard at FL265 to the NNE, then strong once it was 5.5 NM east.
  Our decode matched adsb.lol to within 100 ft, 3 kt and 0.1° of track.
- The test page now draws this as a **coverage outline**: the furthest fix in each 10° sector,
  red on the map. It shows the gaps while the receiver runs.

### Overnight run (25 Oct 22:40 → 26 Oct 09:30, same indoor site)
10.9 hours with no dropouts: 346,368 frames, 105,382 good (30%), 11,244 position fixes from
**344 aircraft**, and only 1 position rejected as implausible. Max range was 43.3 NM, to the
east.

| Sector | Fixes | Aircraft | Max NM | Median alt ft | Lowest alt ft |
|---|---|---|---|---|---|
| N | 246 | 48 | 13.2 | 28,875 | 3,800 |
| NE | 972 | 121 | 18.4 | 24,000 | 3,275 |
| E | 3,244 | 185 | **43.3** | 17,325 | 3,050 |
| SE | 2,003 | 167 | 30.7 | 28,950 | 8,875 |
| S | 2,660 | 178 | 33.7 | 30,625 | 9,150 |
| SW | 1,250 | 137 | 27.4 | 34,000 | 5,375 |
| W | 681 | 88 | 21.5 | 28,150 | 4,200 |
| NW | 188 | 40 | 10.2 | 28,750 | 5,450 |

- **The first likely Farnborough traffic.** The 12 lowest aircraft of the night were all
  business jets, mostly in two clusters: **3,050–3,700 ft, 3.6–6 NM east-north-east of the
  antenna** (about 5–6 NM from EGLF) and **4,200–5,200 ft, about 3–4 NM west**. Callsigns
  include VistaJet (VJT480), NetJets Europe (NJE780G), US-registered N700KS and N606SG, and
  Isle of Man-registered M-ABGS. That's the typical Farnborough mix, caught once the aircraft
  have climbed to about 3,000 ft or above and are clear of the building's shadow.
- **Still nothing below 3,000 ft.** No aircraft at 0–2,000 ft and 7 at 2,000–4,000 ft. Final
  approaches, initial climbs and anything on the ground at EGLF (north of us) aren't received.
- **Live comparison (26 Oct, about 09:35)** against adsb.lol within 12 NM of EGLF: we heard 1 of
  the 4 airborne aircraft (RYR6VG, to the SW). We missed BAW29C at 10,800 ft 3.7 NM NE of EGLF,
  BAW14K at 13,000 ft to the NW, VIR135G at 7,850 ft to the N, and all 4 targets on the ground
  at EGLF. Even mid-level traffic to the north is unreliable from this site.
- North improved overnight to 13.2 NM max and 3,800 ft lowest, from 8 NM and 18,000 ft in the
  first evening. That's more samples, not better reception; NW is still the weakest sector.
- *Capture limitation:* the `--save` file has no timestamps, so time of day can't be recovered
  (the replay assumes an even message rate). Timestamped saves are a small follow-up.

### Indoor siting tests (26 Oct), scored against adsb.lol
Each test is the share of adsb.lol's airborne aircraft within 30 NM that we also heard, using
the test page's *Heard vs adsb.lol* panel with one query every 2 minutes. An aircraft counts
once per query. The tests ran one after another, so the time of day differs between them.

| Share heard | Office, downstairs, S window | Studio, downstairs, N window | **Bathroom, upstairs, N window** | Bedroom, upstairs, S window |
|---|---|---|---|---|
| Antenna height | sill | sill | **just under the ceiling** | on the floor |
| When | 09:39–10:10 | 10:10–12:34 | 12:34–15:34 | 15:34–19:33 |
| **All** | 13% (63/475) | 22% (467/2078) | **28%** (679/2466) | 21% (604/2852) |
| N | 5% | 13% | 16% | 14% |
| NE (Heathrow) | 4% | 8% | 9% | 9% |
| NW | 6% | 21% | 25% | 19% |
| S | 45% | 55% | **68%** | 42% |
| Below 3,000 ft | 0/130 | 0/463 | 5/578 (1%) | 2/838 (0%) |
| 3,000–10,000 ft | 5% | 7% | 9% | 7% |
| 10,000–20,000 ft | 25% | 35% | 41% | 34% |
| Above 20,000 ft | 33% | 50% | 59% | 57% |

**Time-of-day check:** the office position repeated at 19:39–21:00 scored **12%** (77/650), against
13% in the morning. N was 3%, S 37%, below 3,000 ft 0/186. So the differences between positions
are real, not the time of day. This was the last laptop test; the dongle then moved to the Pi.

**The site:** trees on all sides. The house sits high, with the land sloping away to the south,
and there is limited visibility behind it to the north. No direction has a clear line to the
horizon.

- **Antenna height decides the score, not window direction.** The bathroom (antenna near the
  ceiling) was best in every direction, including south. The bedroom faces south, but with the
  antenna on the floor it scored like downstairs.
- **The north is blocked by trees, and possibly by the ground behind the house, not by which
  window is used.** North scored 13–16% from every position after the office, and 3,000–10,000 ft
  to the north stayed near zero (e.g. 2/140 from the bedroom). Low traffic towards EGLF, 4.8 NM
  at about 003° and a degree or two above the horizon, has to pass through the full depth of
  tree cover.
- **The south slope is why south is best everywhere** (43 NM maximum range).
- **No indoor position gets below 3,000 ft:** 7 sightings out of more than 2,000 at that level.
- Some of the bedroom's lower score is the time of day: 29% of its sightings were below
  3,000 ft, against 23% for the bathroom. Adjusted to the bathroom's altitude mix it would be
  about 24%, so still below the bathroom.
- **Seasonal effect to check:** leaves absorb 1090 MHz signals, more when wet. If the trees are
  mostly deciduous, re-run these tests in mid-winter, when coverage should be at its best.

**Conclusion for siting:** this site is a useful general feeder, especially for traffic to the
south and at mid and high levels. **To see Farnborough's low traffic, the antenna has to get
above the trees to the north.** A gable or chimney mount clears the house but probably not
mature trees. So the realistic options are a tall mast, or a second receiver at a site with a
clear view towards EGLF.

### What R0 tells us
1. **Reception works**, and the decoded data matches the aggregators. The hardware chain and
   driver are fine.
2. **Antenna placement is the main problem, before anything else.** The view is blocked to the
   north, which is exactly where Farnborough is. Moving the antenna will do more than any
   amplifier or software change. See R1.
3. **`rtl_adsb` is the software bottleneck.** About two thirds of its output fails CRC, and its
   simple demodulator misses weaker frames altogether. readsb on the Pi should decode several
   times as many messages from the same signal.
4. **Restarting can leave the dongle silent.** After the receiver was killed abruptly, one
   restart produced frames that all failed CRC. Running `rtl_adsb` cleanly again fixed it. If
   good msgs/s sits at 0 while adsb.lol shows traffic in view, stop everything (including any
   leftover `rtl_adsb.exe`) and restart.
5. **airplanes.live returned HTTP 403** to a plain `curl` from the home connection, asking for
   contact by email. adsb.lol answered normally. This doesn't affect the Worker as far as we
   know, but it's worth checking alongside the earlier 429 finding (`RECORDING-PAUSE.md`), and
   another reason to feed them.

---

## 4. Phases

### R1 — Laptop tuning experiments (no new software)
Use the test receiver's figures (**good msgs/s**, **max range**, **CRC pass %**) to compare
changes one at a time. Record each run with `--save` so it can be replayed.
- [x] Real antenna location set (in `receiver/station.json`) so ranges and bearings are correct.
- [x] **Scoring tool:** the test page's *Heard vs adsb.lol* panel gives the share of
      adsb.lol's nearby aircraft that we also heard, by direction and altitude band, in named
      test sessions. It makes one query per 2 minutes, with backoff (see `receiver/README.md`).
      First reading, window site, 26 Oct about 10:10: **23% overall, 0% below 3,000 ft, 0% N
      and NE**.
- [x] **Indoor siting tested** (four positions, see *Indoor siting tests* above). The best is
      upstairs with the antenna high, but nothing indoors sees below 3,000 ft or clears the
      trees to the north. Remaining checks: a window-open test at any window that opens (does
      the glass matter? The bathroom window is fixed), HeyWhatsThat for the terrain to the
      north, and a winter re-test.
- [ ] *(Original aim, now known to need an outdoor antenna or another site.)*
      **Siting first: find a view to the north.** Compare the coverage outline and lowest
      altitude decoded in each spot: a north-facing window, the loft (the roof tiles are
      usually much less of a barrier than walls), then outdoors on the north side. The aim is
      fixes below 2,000 ft in the N sector, i.e. Farnborough traffic.
- [ ] **Gain sweep:** auto vs `--gain 49.6`, `42.1`, `36.4`, `28.0`. Run each for 10+ minutes at
      a similar time of day. Automatic gain is usually worse for ADS-B.
- [ ] **Antenna:** set the stock dipole elements to about 6.9 cm each (a quarter wave at
      1090 MHz), vertical. Then try a homemade quarter-wave ground plane: a 69 mm vertical
      element with 4 radials of about 69 mm drooped about 45°, on the coax. Higher and nearer a
      window facing Farnborough is better; outdoors or in the loft is better still.
- [ ] Log results in a table here, before and after.

### R2 — Better RF front end (small spend)
- [ ] **1090 MHz bandpass filter + low-noise amplifier**, ideally a combined filtered LNA powered
      over the coax by the V3's bias tee (`rtl_biast -b 1`). The Farnborough/Heathrow area is
      RF-busy (mobile, DME, radar), and a filter in front of the dongle stops strong
      out-of-band signals overloading it. **Only enable the bias tee when the amplifier is
      fitted.**
- [ ] **Antenna:** a proper 1090 MHz collinear or ground plane, mounted as high as is practical
      with clear sky toward EGLF. Keep the coax short, or put the amplifier at the antenna.
- [ ] Alternative to the separate filter and amplifier: a dedicated ADS-B dongle with them
      built in. Keep the V3 for general SDR use. *(Compare current models and prices before
      buying.)*

### R3 — Raspberry Pi receiver 🟡 running (26 Oct 2026)
**Hardware:** an existing **Raspberry Pi 3 Model B+** (quad-core 1.4 GHz, 1 GB RAM, Ethernet and
Wi-Fi) with the RTL-SDR Blog V3. That's plenty for readsb, tar1090, graphs1090 and a handful of
feeds. adsb.im lists the "Pi Model 3 A+/B(+)" as actively tested and the V3 as a good ADS-B dongle.
Its one caveat is that a Pi 3 is *"more likely to exhibit some MLAT instability"*, which is one
reason to keep the number of MLAT feeds small (R4).

- [x] **Software: the adsb.im image** (v3.0.15 at setup). It bundles readsb, tar1090 and
      graphs1090, plus the feed clients, all set up from a web UI.
  - Setup and status: `http://adsb-feeder.local/` (System → Management for Wi-Fi, authentication
    and container restarts; Data Sharing for feeds).
  - Map: `http://adsb-feeder.local:8080/`. Aircraft data:
    `http://adsb-feeder.local:8080/data/aircraft.json`, in the same layout as our test page.
  - Antenna location and height are entered in its setup. They stay on the Pi, not in this repo.
- [ ] **Turn on web UI authentication** (System → Management → *Enable Authentication*). It's off
      by default, so anyone on the home network can change settings.
- [ ] **Placement:** upstairs bathroom, antenna **as high as possible** (just under the ceiling,
      the best indoor result). The dongle goes on a **short USB extension (20–50 cm)** to keep it
      clear of the Pi's own noise; the V3 is also too wide to sit beside the Pi's other USB ports.
- [ ] **Power: PoE (power over Ethernet)** from the existing PoE switch. There's no socket in the
      bathroom (UK rules keep them away from baths and showers). One cable gives power and a
      wired network, and the same setup carries over to an outdoor antenna later.
  - **The switch must be standard PoE, 802.3af or 802.3at**, not "passive" PoE (e.g. older 24 V
    Ubiquiti gear), which can damage devices. Use a port that actually supplies PoE. The load is
    only about 3–5 W (the Pi plus the dongle), well within any PoE budget.
  - **Preferred: a PoE splitter**, 802.3af in, **micro-USB 5 V ≥ 2.4 A** out. It's cheap and
    silent, keeps heat off the Pi, and keeps its power converter away from the radio.
  - **Alternative: the official PoE HAT or PoE+ HAT** (check the listing says 3B+). It's tidier,
    but has a small fan, adds heat in the case, and puts a power converter right on the board.
  - Cat5e/Cat6 is fine up to 100 m, so later the Pi can sit right at an outdoor antenna, with a
    short coax lead and the long run done in network cable.
  - Once it's wired, turn Wi-Fi off; the saved Wi-Fi details can stay as a fallback. The image's
    hotspot fallback (on by default) lets you fix network settings if the Pi ever has no
    network.
- [ ] **Power options rejected:** the bathroom shaver socket (rated only for shavers and
      toothbrushes), a mains extension into the bathroom, and a power bank for permanent use
      (very roughly 12–18 h from 20,000 mAh, and many briefly cut power while charging, which
      reboots the Pi). Solar is overkill unless there's no mains at all. *Interim option:* Pi on
      the landing by a socket, with a 5 m **active** USB extension to the dongle in the bathroom.
- [ ] Gain: start with readsb's automatic gain, then check graphs1090 after a few days.
- [ ] Point the test page's *Heard vs adsb.lol* scoring at the Pi's `aircraft.json`, so it can be
      compared directly with the laptop tests (R1).

**Parts list:** Pi 3B+ ✅, RTL-SDR Blog V3 ✅, PoE switch ✅, microSD card ✅ (name-brand; a bigger
card lasts longer because writes are spread out), short USB extension, 802.3af PoE splitter with
micro-USB output (or a PoE HAT), Cat5e/6 cable to the switch, and a case. Later, for outdoors: a
weatherproof box, an outdoor 1090 MHz antenna, a short low-loss coax lead, and **surge protection
and earthing** for the mast and the coax or network cable.

### R4 — Feed the aggregators 🟡 feeding (26 Oct 2026)
Setup's *All* quick-select had enabled about 22 account-less feeds, with MLAT on and the privacy
flag off. That was trimmed down: each MLAT feed runs its own MLAT client, which is a load on a
Pi 3 and the likely trigger for its known MLAT instability, and most of the long tail re-share
the same community data.

- [x] **adsb.lol**: data good. MLAT showed *disconnected* just after the change. *(Re-check;
      if it persists, toggle MLAT or restart its container.)*
- [x] **airplanes.live**: data good, MLAT good. A personal map link
      (`globe.airplanes.live/?uuid=…`) is on the Pi's homepage. *(Kept out of this repo.)*
- [x] **adsb.fi**: data good, MLAT good.
- [x] **Privacy flag ON**: the station doesn't appear on public aggregator maps. MLAT servers
      still receive the exact location, which MLAT needs.
- [ ] **1090MHz UK**: needs a sharing key, requested by email to info@1090mhz.uk on 26 Oct. Paste
      it into Data Sharing when it arrives. Also ask whether "MLAT UK" (on under *All*, and
      possibly unticked by *Individual*) is part of 1090MHz UK, and re-enable it if so.
- [ ] Optional: ADS-B Exchange (large, but commercially owned and less open now), and
      Flightradar24 / FlightAware (accounts and keys needed, but they give free premium
      accounts; FR24 Business is useful since we already use Flightradar).
- [ ] Watch whether feeding changes airplanes.live's earlier HTTP 403 response to us, and the
      adsb.lol rate limits (`RECORDING-PAUSE.md`).

### R5 — Use our receiver in Fight or Flight
- [ ] Expose the Pi's `aircraft.json` safely: a Cloudflare Tunnel from the Pi, or the Pi pushing
      to the Worker. Never open a router port.
- [ ] Worker: for requests near Farnborough, use our receiver as the primary source, with
      airplanes.live / adsb.lol as fallback and for wider areas. Keep the `NormalizedFlight`
      wire contract unchanged; only the Worker's upstream changes.
- [ ] Bonus data that only a local receiver gives: per-aircraft signal strength (RSSI) and
      message rate, plus continuous low-level tracks for the ascent/descent heuristic
      (`ASCENT-DESCENT-HEURISTIC.md`).
- [ ] Keep the **"indicative, not proof"** framing. Our own receiver improves coverage, but it's
      still unofficial data.

---

## 5. Optional: run readsb on the laptop before the Pi
Possible with **WSL2 + usbipd-win** (forwards the USB dongle into Linux), then build or install
readsb/tar1090 there. It would show readsb's improvement over `rtl_adsb` on the same antenna.
**Not recommended unless R3 is delayed:** it's fiddly, the dongle has to be re-attached after
every reboot, and the Pi is where the stack will live anyway. Another quick Windows-native
comparison is **SDRangel**, a maintained SDR suite with an ADS-B demodulator and map. *(Not
tested yet.)*

---

## 6. Honest constraints
- A single receiver only sees aircraft with line of sight. Low-level traffic behind terrain or
  buildings will be patchy until the antenna is high.
- ADS-B shows what the aircraft reports about itself. Mode S-only aircraft (no ADS-B position)
  show altitude and squawk but no position unless MLAT supplies one.
- One dongle can only be opened by one program at a time. Close SDR#/SDR++ before running the
  receiver.

## 7. Open items
- Final antenna site (loft, north window, roof or garden mast?). It needs a clear view north to
  EGLF, 4.8 NM at about 003°.
- Budget for R2 (filter + amplifier, antenna, coax) and R3 (Pi, power supply, case).
- Which aggregators get MLAT (privacy decision).
- How the Pi reaches the Worker (Tunnel vs push).
