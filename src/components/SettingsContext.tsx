import { createContext, useContext } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings'

// App-wide settings (units, N, radius, location). Components read units from here
// so display reacts live to changes.
export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS)

export function useSettings(): Settings {
  return useContext(SettingsContext)
}
