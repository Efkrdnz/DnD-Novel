import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import type { TextSpeed } from '../../../../shared/settings'

/** Characters per second at each setting. */
const RATE: Record<Exclude<TextSpeed, 'instant'>, number> = { slow: 28, normal: 60, fast: 130 }
/** When the reveal falls this far behind the stream, it speeds up to catch up. */
const CATCH_UP_AFTER = 240

/**
 * Reveals streamed text at a steady pace, the way a visual novel types out a line.
 * Returns the visible part and a function that shows everything at once.
 */
export function useTypewriter(text: string, speed: TextSpeed): { shown: string; done: boolean; skip: () => void } {
  const reduced = useReducedMotion()
  const instant = speed === 'instant' || reduced === true
  const [count, setCount] = useState(instant ? text.length : 0)
  const countRef = useRef(count)
  const targetRef = useRef(text.length)
  targetRef.current = text.length

  // A new, shorter text means a new turn: start over.
  useEffect(() => {
    if (text.length < countRef.current) {
      countRef.current = 0
      setCount(0)
    }
  }, [text])

  useEffect(() => {
    if (instant) return
    let frame = 0
    let last = performance.now()
    let carry = 0
    const tick = (now: number) => {
      const behind = targetRef.current - countRef.current
      if (behind > 0) {
        const rate = RATE[speed as keyof typeof RATE] + (behind > CATCH_UP_AFTER ? behind * 2 : 0)
        carry += ((now - last) / 1000) * rate
        const step = Math.floor(carry)
        if (step > 0) {
          carry -= step
          countRef.current = Math.min(targetRef.current, countRef.current + step)
          setCount(countRef.current)
        }
      } else carry = 0
      last = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [instant, speed])

  const skip = useCallback(() => {
    countRef.current = targetRef.current
    setCount(targetRef.current)
  }, [])

  const visible = instant ? text.length : Math.min(count, text.length)
  return { shown: text.slice(0, visible), done: visible >= text.length, skip }
}
