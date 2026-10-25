# Own ADS-B Receiver — Hardware Plan
*Build our own 1090 MHz ADS-B receiver near Farnborough (EGLF), feed it to the community
aggregators, and eventually use it as a first-hand data source for Fight or Flight.*

> **Status (October 2026): phase R0 (laptop proof of reception) ✅ done.** The RTL-SDR Blog
> V3 receives and decodes ADS-B on the Windows laptop with the stock antenna indoors. The test
> receiver lives in [`../receiver/`](../receiver/README.md). Phases R1 onwards are still to do.

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
  the app is about.**
- Cross-check (25 Oct, about 22:40): at a quiet time, 34 aircraft were airborne within 60 NM on
  adsb.lol. Most were in the Heathrow flow to the N/NE, including arrivals at 125–1,800 ft at
  about 21 NM, and we decoded none of those. Flightradar24 showed the same. RYR66PG, climbing
  out SSE past us, was barely heard at FL265 to the NNE, then strong once it was 5.5 NM east.
  Our decode matched adsb.lol to within 100 ft, 3 kt and 0.1° of track.
- The test page now draws this as a **coverage outline**: the furthest fix in each 10° sector,
  red on the map. It shows the gaps while the receiver runs.

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
- [ ] **Siting first: find a view to the north.** Compare the coverage outline and lowest
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

### R3 — Raspberry Pi receiver
- [ ] Pi with a good power supply, the V3 (or ADS-B dongle) and the R2 antenna.
- [ ] Software stack: **readsb** (decoder) + **tar1090** (map) + **graphs1090** (performance
      graphs). The adsb.im image sets these up and configures feeds from a web UI; the manual
      alternative is wiedehopf's install scripts. *(Pick one when we get there.)*
- [ ] Use the same gain approach as R1 (readsb has automatic gain tuning; check graphs1090 after
      a few days).
- [ ] Point the test page at the Pi's `aircraft.json` to confirm the format matches.

### R4 — Feed the aggregators
- [ ] **airplanes.live** and **adsb.lol** first: they're non-profit and the app already uses
      them. Both take a readsb network feed, and **mlat-client** for MLAT (locating aircraft
      that have no ADS-B by timing replies across several receivers).
- [ ] Optional: ADS-B Exchange, FlightAware, Flightradar24. The commercial ones give feeders
      perks such as premium accounts. *(Check their current terms.)*
- [ ] **Privacy:** MLAT needs the exact antenna location and height. The aggregators blur it on
      public maps, but they hold the exact figure. Decide which feeds get MLAT.
- [ ] Check our station appears on each aggregator's feeder status page.

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
