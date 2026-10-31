import { useState, type ComponentProps, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { ChevronDown, Eye, EyeOff, Loader2 } from 'lucide-react'
import { cn } from '../lib/util'

export const spring = { type: 'spring', stiffness: 520, damping: 32 } as const

const BUTTON_VARIANTS = {
  primary:
    'text-white bg-linear-to-br from-violet-500 via-fuchsia-500 to-pink-500 shadow-lg shadow-fuchsia-300/50 ring-1 ring-white/40 hover:shadow-fuchsia-400/60',
  secondary: 'bg-white/90 text-ink shadow-md shadow-indigo-200/60 ring-1 ring-indigo-100 hover:bg-white',
  ghost: 'text-indigo-800/80 hover:bg-white/70 hover:text-ink',
  danger: 'text-white bg-linear-to-br from-rose-500 to-pink-600 shadow-md shadow-rose-300/50',
} as const

const BUTTON_SIZES = {
  sm: 'h-9 gap-1.5 rounded-xl px-3 text-sm',
  md: 'h-11 gap-2 rounded-2xl px-5',
  lg: 'h-14 gap-2.5 rounded-2xl px-7 text-lg',
} as const

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: keyof typeof BUTTON_VARIANTS
  size?: keyof typeof BUTTON_SIZES
  icon?: ReactNode
  loading?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const inactive = Boolean(disabled || loading)
  return (
    <motion.button
      type={type}
      whileHover={inactive ? undefined : { y: -2 }}
      whileTap={inactive ? undefined : { scale: 0.95 }}
      transition={spring}
      disabled={inactive}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center font-bold whitespace-nowrap transition-[background,box-shadow,opacity] disabled:cursor-not-allowed disabled:opacity-45',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </motion.button>
  )
}

export function IconButton({
  label,
  icon,
  className,
  variant = 'ghost',
  ...rest
}: Omit<ButtonProps, 'children' | 'icon'> & { label: string; icon: ReactNode }) {
  return <Button aria-label={label} title={label} variant={variant} size="sm" icon={icon} className={cn('w-9 px-0', className)} {...rest} />
}

const FIELD =
  'w-full rounded-2xl border-2 border-indigo-100 bg-white/90 px-4 py-2.5 text-ink shadow-inner shadow-indigo-50 outline-none transition placeholder:text-indigo-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-200/60 disabled:opacity-60'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD, 'resize-none leading-relaxed', className)} {...props} />
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false} className="pr-12 font-mono" />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide key' : 'Show key'}
        className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-xl text-indigo-400 hover:bg-indigo-50 hover:text-violet-600"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(FIELD, 'cursor-pointer appearance-none pr-10', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-indigo-400" />
    </div>
  )
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-bold text-indigo-900">{label}</span>
      {children}
      {hint && <span className="text-xs text-indigo-700/60">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-7 w-12 shrink-0 cursor-pointer rounded-full p-1 transition-colors',
        checked ? 'justify-end bg-linear-to-r from-violet-500 to-pink-500' : 'justify-start bg-indigo-100',
      )}
    >
      <motion.span layout transition={spring} className="block size-5 rounded-full bg-white shadow" />
    </button>
  )
}

interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  label: string
  onChange: (value: number) => void
  format?: (value: number) => string
}

export function Slider({ value, min, max, step, label, onChange, format }: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 flex-1 cursor-pointer accent-violet-500"
      />
      <motion.span
        key={value}
        initial={{ scale: 1.15 }}
        animate={{ scale: 1 }}
        className="min-w-16 rounded-xl bg-white/85 px-2 py-1 text-center text-sm font-extrabold text-violet-700 tabular-nums shadow-sm"
      >
        {format ? format(value) : value}
      </motion.span>
    </div>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  size = 'md',
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  layoutId: string
  size?: 'md' | 'lg'
}) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-2xl bg-white/60 p-1 shadow-inner ring-1 ring-white">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex cursor-pointer items-center gap-2 rounded-xl font-bold transition-colors',
              size === 'lg' ? 'px-5 py-2.5' : 'px-3.5 py-1.5 text-sm',
              active ? 'text-white' : 'text-indigo-700/70 hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={spring}
                className="absolute inset-0 rounded-xl bg-linear-to-br from-violet-500 to-pink-500 shadow-md shadow-fuchsia-300/50"
              />
            )}
            <span className="relative flex items-center gap-2">
              {option.icon}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
