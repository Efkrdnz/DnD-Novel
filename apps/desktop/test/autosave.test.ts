import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaver } from '../src/main/saves/autosave'

describe('createAutosaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces bursts into one save of the latest value', () => {
    const save = vi.fn()
    const autosave = createAutosaver<string>(save, 1000)

    autosave.schedule('a')
    autosave.schedule('b')
    vi.advanceTimersByTime(999)
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('b')
  })

  it('flush saves pending work immediately, once', () => {
    const save = vi.fn()
    const autosave = createAutosaver<string>(save, 1000)

    autosave.schedule('x')
    autosave.flush()
    vi.advanceTimersByTime(5000)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('x')
  })

  it('flush with nothing pending does nothing', () => {
    const save = vi.fn()
    createAutosaver<string>(save, 1000).flush()
    expect(save).not.toHaveBeenCalled()
  })
})
