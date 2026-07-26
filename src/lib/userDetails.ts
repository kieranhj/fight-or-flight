// The complainant's identity for the complaint template. Persisted locally so it's
// entered once. Never sent anywhere except into the message the user themselves
// delivers (mailto/copy) — we never auto-submit.

export type UserDetails = { name: string; address: string; postcode: string }

const KEY = 'foaf.userDetails'

// No prefill: nothing personal ships with the app. Users enter their own
// details once; they live only in this device's localStorage.
function defaults(): UserDetails {
  return { name: '', address: '', postcode: '' }
}

export function loadUserDetails(): UserDetails {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return defaults()
}

export function saveUserDetails(d: UserDetails): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* ignore */
  }
}
