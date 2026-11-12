const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const dayMonth = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const utcTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso))
export const fmtDay = (iso: string) => dayMonth.format(new Date(iso))
export const fmtTime = (iso: string) => time.format(new Date(iso))
export const fmtUtcTime = (iso: string) => `${utcTime.format(new Date(iso))} UTC`

export function fmtRelative(iso: string, now = Date.now()) {
  const hours = (new Date(iso).getTime() - now) / 3_600_000
  return Math.abs(hours) < 36
    ? relative.format(Math.round(hours), 'hour')
    : relative.format(Math.round(hours / 24), 'day')
}

export const fmtPlatform = (p: string | null) =>
  p ? p.replace(/^sentinel-(\w+)$/i, (_, id: string) => `Sentinel-${id.toUpperCase()}`) : '—'

export const todayIso = () => new Date().toISOString().slice(0, 10)
