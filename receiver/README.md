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
