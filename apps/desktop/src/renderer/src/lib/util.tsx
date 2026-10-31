export const cn = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(' ')

export const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Turns an IPC error into something a player can read. */
export function errorMessage(err: unknown): string {
  // IPC errors arrive as "Error invoking remote method '...': Error: <message>".
  const text = (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    '',
  )
  // Zod validation errors arrive as a JSON list of issues; show the first one.
  if (text.trimStart().startsWith('[')) {
    try {
      const issues = JSON.parse(text) as { message?: string }[]
      if (issues[0]?.message) return issues[0].message
    } catch {
      // not JSON after all
    }
  }
  return text
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/** 420 · 3.1k · 182k */
export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count))
  const thousands = count / 1000
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, '') : Math.round(thousands)}k`
}

export function relativeTime(iso: string, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  let value = (Date.parse(iso) - now) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit)
    value /= size
  }
  return ''
}

/** Renders **bold** and *italic* from GM text. Everything else stays plain text (no HTML). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
        if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
        return part
      })}
    </>
  )
}
