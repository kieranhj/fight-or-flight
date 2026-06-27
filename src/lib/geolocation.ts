// Thin promise wrapper around the browser Geolocation API with human-readable
// error messages. Device GPS is the default location source (Build Plan §1).

export type GeoResult = { lat: number; lon: number; accuracyM: number }

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 30_000,
}

function messageFor(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission denied. Enable location access for this site, then tap again.'
    case err.POSITION_UNAVAILABLE:
      return 'Couldn’t get a location fix. Try again, ideally outdoors with a clear view of the sky.'
    case err.TIMEOUT:
      return 'Location request timed out. Tap to try again.'
    default:
      return 'Couldn’t get your location.'
  }
}

export function getCurrentPosition(): Promise<GeoResult> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device has no Geolocation support.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }),
      (err) => reject(new Error(messageFor(err))),
      GEO_OPTIONS,
    )
  })
}
