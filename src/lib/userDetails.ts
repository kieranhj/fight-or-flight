import { HOME_LOCATION } from '../config/airports'

// The complainant's identity for the complaint template. Persisted locally so it's
// entered once. Never sent anywhere except into the message the user themselves
// delivers (mailto/copy) — we never auto-submit.

export type UserDetails = { name: string; address: string; postcode: string }

const KEY = 'foaf.userDetails'

// Seed address/postcode from the home location in config (Build Plan §7); name blank.
function defaults(): UserDetails {
  const parts = HOME_LOCATION.label.split(',').map((s) => s.trim())
  const postcode = parts[0] ?? ''
  const address = parts.slice(1).join(', ')
  return { name: '', address, postcode }
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
