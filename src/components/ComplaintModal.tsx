import { useEffect, useMemo, useRef, useState } from 'react'
import type { NormalizedFlight } from '../lib/adsb'
import { assessFlight } from '../lib/assess'
import { buildComplaint, mailtoUrl } from '../lib/complaint'
import { loadUserDetails, saveUserDetails, type UserDetails } from '../lib/userDetails'
import { addIncident, incidentFromFlight } from '../lib/log'
import type { ComplaintChannel } from '../config/types'

export default function ComplaintModal({
  flight,
  observedAt,
  onClose,
  onLogged,
}: {
  flight: NormalizedFlight
  observedAt: number
  onClose: () => void
  onLogged?: () => void
}) {
  const now = useRef(new Date()).current
  const assessment = useMemo(() => assessFlight(flight, now), [flight, now])

  const [details, setDetails] = useState<UserDetails>(() => loadUserDetails())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const built = useMemo(
    () => buildComplaint(flight, assessment, details, now),
    [flight, assessment, details, now],
  )
  const airport = built.airport

  // (Re)generate from the template while the user hasn't hand-edited the message.
  useEffect(() => {
    if (edited) return
    setSubject(built.subject)
    setBody(built.body)
  }, [built, edited])

  function updateDetail(key: keyof UserDetails, value: string) {
    const next = { ...details, [key]: value }
    setDetails(next)
    saveUserDetails(next)
  }

  function logOnce() {
    if (saved) return
    addIncident(incidentFromFlight(flight, assessment, observedAt, Date.now()))
    setSaved(true)
    onLogged?.()
  }

  async function copy(text: string, label: string) {
    logOnce()
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`${label} copied — saved to your incident log.`)
    } catch {
      setNotice('Could not access the clipboard — select the text and copy manually.')
    }
  }

  function openMailto(email: string) {
    logOnce()
    setNotice('Opening your email app — review, then send. Saved to your incident log.')
    window.location.href = mailtoUrl(email, subject, body)
  }

  const fullText = `${subject}\n\n${body}`

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Generate complaint"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-white">Complaint</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
          >
            Close
          </button>
        </div>

        <div className="mb-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5 text-xs leading-relaxed text-sky-100/90">
          This never sends anything automatically. It prefills an editable message for you to review
          and send yourself.
        </div>

        {/* Your details */}
        <div className="mb-3 grid gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Your details (saved on this device)
          </span>
          <input
            value={details.name}
            onChange={(e) => updateDetail('name', e.target.value)}
            placeholder="Full name"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <input
            value={details.address}
            onChange={(e) => updateDetail('address', e.target.value)}
            placeholder="Address"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <input
            value={details.postcode}
            onChange={(e) => updateDetail('postcode', e.target.value)}
            placeholder="Postcode"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>

        {/* Editable message */}
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Subject
        </label>
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value)
            setEdited(true)
          }}
          className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        />
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Message
          </label>
          {edited && (
            <button
              onClick={() => setEdited(false)}
              className="text-[11px] font-medium text-sky-400"
            >
              Reset to template
            </button>
          )}
        </div>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            setEdited(true)
          }}
          rows={12}
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100"
        />

        {/* Delivery */}
        <div className="space-y-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Send to {airport ? airport.name : 'the right authority'}
          </span>

          {airport ? (
            airport.channels.map((ch: ComplaintChannel) => {
              if (ch.kind === 'email' && ch.email) {
                return (
                  <button
                    key={ch.label}
                    onClick={() => openMailto(ch.email!)}
                    className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white active:scale-[0.99]"
                  >
                    {ch.label} ({ch.email})
                  </button>
                )
              }
              if (ch.kind === 'web-form' && ch.url) {
                return (
                  <div key={ch.label} className="flex gap-2">
                    <button
                      onClick={() => copy(fullText, 'Complaint text')}
                      className="flex-1 rounded-lg bg-slate-700 px-3 py-3 text-sm font-semibold text-white active:scale-[0.99]"
                    >
                      Copy text
                    </button>
                    <a
                      href={ch.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={logOnce}
                      className="flex-1 rounded-lg bg-sky-500 px-3 py-3 text-center text-sm font-semibold text-white active:scale-[0.99]"
                    >
                      Open {ch.label}
                    </a>
                  </div>
                )
              }
              if (ch.kind === 'phone' && ch.phone) {
                return (
                  <a
                    key={ch.label}
                    href={`tel:${ch.phone.replace(/\s/g, '')}`}
                    onClick={logOnce}
                    className="block w-full rounded-lg border border-slate-700 px-4 py-3 text-center text-sm font-semibold text-slate-200"
                  >
                    Call {ch.phone}
                  </a>
                )
              }
              return null
            })
          ) : (
            <p className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs leading-relaxed text-slate-400">
              This flight couldn’t be tied to Farnborough, Heathrow or Gatwick (transit / unknown),
              so there’s no single airport to write to. For airspace or route-design concerns,
              contact the CAA airspace team or your MP. You can still copy the text below.
            </p>
          )}

          <button
            onClick={() => copy(fullText, 'Full complaint')}
            className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200"
          >
            Copy full text
          </button>
        </div>

        <div className="mt-2 min-h-[1rem] text-center text-xs" aria-live="polite">
          {notice && <span className="text-emerald-400">{notice}</span>}
        </div>
      </div>
    </div>
  )
}
