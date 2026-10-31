export interface Autosaver<T> {
  /** Queue a value; only the latest one is saved once things go quiet for `delayMs`. */
  schedule: (value: T) => void
  /** Save any pending value now (e.g. on quit). */
  flush: () => void
}

export function createAutosaver<T>(
  save: (value: T) => void,
  delayMs: number,
  onError: (err: unknown) => void = (err) => console.error('Autosave failed:', err),
): Autosaver<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    try {
      save(value)
    } catch (err) {
      onError(err)
    }
  }

  const schedule = (value: T): void => {
    pending = { value }
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }

  return { schedule, flush }
}
