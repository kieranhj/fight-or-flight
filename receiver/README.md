# Local ADS-B test receiver (laptop)

A first test of our own 1090 MHz reception with an RTL-SDR Blog V3 on Windows, before
moving to a Raspberry Pi. Not part of the PWA build.

```
dongle --> bin/rtl_adsb.exe --> adsb_local.py (CRC check + decode) --> http://localhost:8090
                                     \--> /data/aircraft.json (dump1090/readsb format)
```

## Setup (once)

1. Driver: the dongle needs the WinUSB driver (Zadig, "Bulk-In, Interface (Interface 0)").
2. Tools: download `Release.zip` from https://github.com/rtlsdrblog/rtl-sdr-blog/releases
   (V1.4.0 tested) and copy the contents of its `x64/` folder into `receiver/bin/`.
3. Check the dongle: `receiver\bin\rtl_test.exe -s 2000000`. It should list the R820T
   tuner, then print nothing more (any "lost bytes" lines mean USB trouble).

Python 3.11+ only; no packages to install.

4. Location: create `receiver/station.json` with `{"lat": <antenna lat>, "lon": <antenna lon>}`.
   It is git-ignored on purpose, because **this repo is public** and the exact antenna position
   is a home address. Without it, ranges and bearings are measured from EGLF.

## Run

```
python receiver/adsb_local.py                                      # location from station.json
python receiver/adsb_local.py --lat <lat> --lon <lon>              # or override it
python receiver/adsb_local.py --gain 49.6                           # fixed gain instead of AGC
python receiver/adsb_local.py --save receiver/captures/today.txt    # keep raw frames
python receiver/adsb_local.py --replay receiver/captures/first-30s.txt   # no dongle needed
```

Close SDR#/SDR++ first, because only one program can open the dongle at a time.

## Reading the numbers

- **CRC pass**: the share of `rtl_adsb` frames that are real Mode S. `rtl_adsb`'s demodulator
  is crude, so 15-35% is normal. readsb on the Pi will do much better.
- **good msgs/s** and **max range** are the figures to compare when you change the antenna
  or the gain.
- DF17 = ADS-B (identity, position, velocity). DF4/20 = altitude replies and DF5/21 = squawk
  replies, both accepted only for aircraft already seen in a clean DF11/17.

## Heard vs adsb.lol (fair antenna tests)

The page's top panel scores us against adsb.lol: of the airborne aircraft it reports within
30 NM, what share did we also hear in the last 60 s? It's split by direction and altitude band.
Because it's a share rather than a count, it stays fair whether the sky is busy or quiet.

- **To compare antenna positions**, type a name (e.g. `loft`) and press **Start new test** when
  you move the antenna. The current test is saved under its name and shows in **Previous
  tests**, kept in `captures/compare-sessions.jsonl`. Swap positions back and forth, giving
  each 20+ minutes.
- **Gentle on adsb.lol** (the Worker's recorder was rate-limited at 4/min, see
  `docs/RECORDING-PAUSE.md`): the receiver makes **one** query every 2 minutes
  (`--compare-every`, never under 60 s; `0` turns it off). The browser never calls adsb.lol.
  Any failure doubles the wait, up to an hour, with no retries, and `Retry-After` is obeyed.
- Not counted: aircraft on the ground, and adsb.lol entries we couldn't hear directly
  (TIS-B/ADS-R rebroadcasts, ADS-C).
