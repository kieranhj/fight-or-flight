import { useState } from 'react'
import type { Settings } from '../lib/settings'
import { loadUserDetails, saveUserDetails, type UserDetails } from '../lib/userDetails'

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-lg border border-slate-700 bg-slate-800/50 p-0.5 text-xs font-medium">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-2 py-1.5 transition ${
            value === o.value ? 'bg-sky-500 text-white' : 'text-slate-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100'

export default function SettingsModal({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
}) {
  const [details, setDetails] = useState<UserDetails>(() => loadUserDetails())

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const setUnit = (patch: Partial<Settings['units']>) =>
    onChange({ ...settings, units: { ...settings.units, ...patch } })
  const setInclude = (patch: Partial<Settings['include']>) =>
    onChange({ ...settings, include: { ...settings.include, ...patch } })
  const updateDetail = (key: keyof UserDetails, value: string) => {
    const next = { ...details, [key]: value }
    setDetails(next)
    saveUserDetails(next)
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
          >
            Done
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Aircraft to show (${settings.n})`}>
              <input
                type="range"
                min={1}
                max={20}
                value={settings.n}
                onChange={(e) => set({ n: Number(e.target.value) })}
                className="w-full accent-sky-500"
              />
            </Field>
            <Field label={`Radius (${settings.radiusNm} nm)`}>
              <input
                type="range"
                min={1}
                max={50}
                value={settings.radiusNm}
                onChange={(e) => set({ radiusNm: Number(e.target.value) })}
                className="w-full accent-sky-500"
              />
            </Field>
          </div>

          <Field label="Units">
            <div className="grid grid-cols-3 gap-2">
              <Segmented
                value={settings.units.alt}
                options={[{ value: 'ft', label: 'ft' }, { value: 'm', label: 'm' }]}
                onChange={(alt) => setUnit({ alt })}
              />
              <Segmented
                value={settings.units.dist}
                options={[{ value: 'nm', label: 'nm' }, { value: 'km', label: 'km' }]}
                onChange={(dist) => setUnit({ dist })}
              />
              <Segmented
                value={settings.units.speed}
                options={[{ value: 'kt', label: 'kt' }, { value: 'kmh', label: 'km/h' }]}
                onChange={(speed) => setUnit({ speed })}
              />
            </div>
          </Field>

          <Field label="Show usually-filtered traffic">
            <div className="space-y-1.5">
              {(
                [
                  { key: 'military', label: 'Military' },
                  { key: 'rotorcraft', label: 'Helicopters' },
                  { key: 'light', label: 'Light aircraft' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={settings.include[opt.key]}
                    onChange={(e) => setInclude({ [opt.key]: e.target.checked })}
                    className="accent-sky-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Off by default. Re-run after changing. These categories are usually filtered out as
              they’re not the airliner/biz-jet traffic the app is about.
            </p>
          </Field>

          <Field label="Location">
            <Segmented
              value={settings.locationMode}
              options={[
                { value: 'gps', label: 'Device GPS' },
                { value: 'home', label: 'Home coords' },
              ]}
              onChange={(locationMode) => set({ locationMode })}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={settings.homeFallback}
                onChange={(e) => set({ homeFallback: e.target.checked })}
                className="accent-sky-500"
              />
              Fall back to home coordinates if GPS is unavailable
            </label>
            {(settings.locationMode === 'home' || settings.homeFallback) && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.0001"
                  value={settings.homeLat}
                  onChange={(e) => set({ homeLat: Number(e.target.value) })}
                  placeholder="Home latitude"
                  className={inputCls}
                />
                <input
                  type="number"
                  step="0.0001"
                  value={settings.homeLon}
                  onChange={(e) => set({ homeLon: Number(e.target.value) })}
                  placeholder="Home longitude"
                  className={inputCls}
                />
              </div>
            )}
          </Field>

          <Field label="Your details (used to prefill complaints)">
            <div className="space-y-2">
              <input
                value={details.name}
                onChange={(e) => updateDetail('name', e.target.value)}
                placeholder="Full name"
                className={inputCls}
              />
              <input
                value={details.address}
                onChange={(e) => updateDetail('address', e.target.value)}
                placeholder="Address"
                className={inputCls}
              />
              <input
                value={details.postcode}
                onChange={(e) => updateDetail('postcode', e.target.value)}
                placeholder="Postcode"
                className={inputCls}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Stored only on this device; only ever travels in a complaint you send yourself.
            </p>
          </Field>
        </div>
      </div>
    </div>
  )
}
