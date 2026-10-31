import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react'
import { Check, Circle, Loader2, X } from 'lucide-react'
import { cn } from '../lib/util'
import { IconButton, spring } from './controls'

export function Card({ className, children, ...rest }: HTMLMotionProps<'section'>) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn('glass rounded-[28px] p-6', className)}
      {...rest}
    >
      {children}
    </motion.section>
  )
}

const TONES = {
  violet: 'from-violet-500 to-fuchsia-500 shadow-fuchsia-300/50',
  gold: 'from-amber-400 to-orange-500 shadow-amber-300/50',
  mint: 'from-emerald-400 to-teal-500 shadow-emerald-300/50',
  sakura: 'from-pink-400 to-rose-500 shadow-pink-300/50',
  sky: 'from-sky-400 to-indigo-500 shadow-sky-300/50',
} as const

export type Tone = keyof typeof TONES

export function IconBadge({ children, tone = 'violet', size = 'md' }: { children: ReactNode; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center bg-linear-to-br text-white shadow-md',
        TONES[tone],
        size === 'sm' && 'size-8 rounded-xl text-base',
        size === 'md' && 'size-11 rounded-2xl text-xl',
        size === 'lg' && 'size-16 rounded-3xl text-3xl',
      )}
    >
      {children}
    </span>
  )
}

export function SectionTitle({
  icon,
  tone,
  title,
  subtitle,
  action,
}: {
  icon: ReactNode
  tone?: Tone
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <IconBadge tone={tone}>{icon}</IconBadge>
      <div className="flex-1">
        <h2 className="text-xl font-extrabold text-indigo-950">{title}</h2>
        {subtitle && <p className="text-sm text-indigo-700/70">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="animate-bob text-6xl text-violet-400 drop-shadow">{icon}</div>
      <p className="text-lg font-extrabold text-indigo-900">{title}</p>
      {children && <div className="max-w-md text-sm text-indigo-700/70">{children}</div>}
    </div>
  )
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  icon,
  wide = false,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  icon?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  // Focus moves into the dialog, Tab stays inside it, and focus returns to what opened it.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => !el.hasAttribute('disabled'))
    // Without scrolling: a long dialog (the story log) keeps the place it opened at.
    const first = window.setTimeout(() => (focusables()[1] ?? focusables()[0] ?? panel.current)?.focus({ preventScroll: true }), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const [head, tail] = [items[0]!, items.at(-1)!]
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(first)
      window.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-indigo-950/30 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={spring}
            className={cn('glass scroll-fancy max-h-[86vh] w-full overflow-y-auto rounded-[28px] p-6', wide ? 'max-w-3xl' : 'max-w-lg')}
          >
            <div className="mb-5 flex items-center gap-3">
              {icon && <IconBadge>{icon}</IconBadge>}
              <h2 className="flex-1 text-xl font-extrabold text-indigo-950">{title}</h2>
              <IconButton label="Close" icon={<X className="size-5" />} onClick={onClose} />
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export type PillState = 'idle' | 'testing' | 'ok' | 'error'

const PILL_STYLES: Record<PillState, string> = {
  idle: 'bg-indigo-50 text-indigo-600',
  testing: 'bg-violet-100 text-violet-700',
  ok: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
}

export function StatusPill({ state, children }: { state: PillState; children: ReactNode }) {
  return (
    <motion.span
      key={state}
      initial={state === 'ok' ? { scale: 0.6, opacity: 0 } : { opacity: 0 }}
      animate={state === 'error' ? { x: [0, -6, 6, -4, 4, 0], opacity: 1 } : { scale: 1, opacity: 1 }}
      transition={state === 'error' ? { duration: 0.4 } : spring}
      className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold', PILL_STYLES[state])}
    >
      {state === 'idle' && <Circle className="size-3 shrink-0" />}
      {state === 'testing' && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      {state === 'ok' && <Check className="size-3.5 shrink-0" strokeWidth={3} />}
      {state === 'error' && <X className="size-3.5 shrink-0" strokeWidth={3} />}
      <span className="truncate">{children}</span>
    </motion.span>
  )
}

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-2 rounded-full bg-violet-400"
          animate={{ y: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  )
}
