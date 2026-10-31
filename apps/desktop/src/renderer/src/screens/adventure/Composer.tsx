import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, SendHorizonal, Square } from 'lucide-react'
import { GiCrossedSwords, GiCrystalBall, GiDiceSixFacesSix, GiSpeaker, GiThreeFriends } from 'react-icons/gi'
import { classifyInput, type Character, type InputMode } from '@dnd/engine'
import { cn } from '../../lib/util'
import { Button, IconButton, Textarea } from '../../ui/controls'
import { DiceTray } from '../../ui/dice'
import { Portrait } from '../../ui/portrait'

const MODE_CHIP: Record<InputMode, { icon: ReactNode; label: string; className: string }> = {
  action: { icon: <GiCrossedSwords />, label: 'Action', className: 'bg-violet-100 text-violet-700' },
  speech: { icon: <GiSpeaker />, label: 'Speaking aloud', className: 'bg-pink-100 text-pink-700' },
  ooc: { icon: <GiCrystalBall />, label: 'Asking the GM · time stops', className: 'bg-sky-100 text-sky-700' },
}

/** Text prepared elsewhere for the composer; a new `key` puts it in again. */
export interface Draft {
  text: string
  key: number
  /** Send it at once (the map's Travel here) instead of leaving it in the composer. */
  autoSend?: boolean
}

interface ComposerProps {
  busy: boolean
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  /** Characters in the scene, for the "Talking to" chip. */
  present: readonly Character[]
  addressee: string | null
  onAddressee: (characterId: string | null) => void
  draft?: Draft | null
  /** Called once an auto-send draft went out, so it is not sent again. */
  onDraftUsed?: () => void
}

/** Picks who the player speaks to; everyone by default. */
function TalkTo({ present, addressee, onAddressee }: Pick<ComposerProps, 'present' | 'addressee' | 'onAddressee'>) {
  const [open, setOpen] = useState(false)
  const target = present.find((c) => c.id === addressee)
  const pick = (id: string | null) => {
    onAddressee(id)
    setOpen(false)
  }
  return (
    <span className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1 font-extrabold ring-1 transition-colors',
          target ? 'bg-pink-50 text-pink-700 ring-pink-200' : 'bg-white/80 text-indigo-600 ring-indigo-100 hover:ring-violet-300',
        )}
      >
        {target ? <Portrait name={target.name} size="sm" art={target.portrait} /> : <GiThreeFriends className="ml-1 size-4" />}
        Talking to: {target?.name ?? 'everyone'}
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            className="absolute bottom-full left-0 z-20 mb-2 flex min-w-48 flex-col gap-0.5 rounded-2xl bg-white/97 p-1.5 shadow-xl shadow-indigo-200/60 ring-1 ring-indigo-100"
          >
            {[null, ...present].map((c) => (
              <li key={c?.id ?? 'everyone'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={(c?.id ?? null) === addressee}
                  onClick={() => pick(c?.id ?? null)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-bold text-ink hover:bg-violet-50',
                    (c?.id ?? null) === addressee && 'bg-violet-50',
                  )}
                >
                  {c ? <Portrait name={c.name} size="sm" art={c.portrait} /> : <GiThreeFriends className="mx-2 size-5 text-indigo-400" />}
                  {c?.name ?? 'Everyone here'}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </span>
  )
}

export function Composer({ busy, onSend, onStop, present, addressee, onAddressee, draft, onDraftUsed }: ComposerProps) {
  const [input, setInput] = useState(draft?.autoSend ? '' : (draft?.text ?? ''))
  const [tray, setTray] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)

  // A new draft (from the Inventory) replaces the text and puts the cursor at its end.
  useEffect(() => {
    if (!draft) return
    if (draft.autoSend && !busy) {
      onDraftUsed?.()
      void onSend(draft.text).then((sent) => !sent && setInput(draft.text))
      return
    }
    setInput(draft.text)
    const el = field.current
    if (el) {
      el.focus()
      el.setSelectionRange(draft.text.length, draft.text.length)
    }
  }, [draft])
  const mode = classifyInput(input).mode
  const chip = MODE_CHIP[mode]

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    if (!(await onSend(text))) setInput(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      className="relative border-t border-white/70 bg-white/45 px-5 py-4"
    >
      <AnimatePresence>
        {tray && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full left-5 z-20 mb-2 rounded-3xl bg-white/95 p-4 shadow-xl shadow-indigo-200/60 ring-1 ring-indigo-100"
          >
            <DiceTray />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-end gap-3">
        <IconButton
          label="Dice tray"
          icon={<GiDiceSixFacesSix className="size-5" />}
          aria-pressed={tray}
          onClick={() => setTray((open) => !open)}
          className={cn('h-11 w-11', tray && 'bg-white text-violet-600')}
        />
        <Textarea
          ref={field}
          rows={Math.min(5, Math.max(1, input.split('\n').length))}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={8000}
          aria-label="What do you do?"
          placeholder={'What do you do?   ·   "quotes" to speak   ·   [brackets] ask the GM'}
          className="flex-1"
        />
        {busy ? (
          <Button variant="danger" icon={<Square className="size-4" fill="currentColor" />} onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" icon={<SendHorizonal className="size-4" />} disabled={!input.trim()}>
            Send
          </Button>
        )}
      </div>
      <div className="mt-2 flex h-7 items-center gap-3 text-xs font-semibold text-indigo-700/45">
        {present.length > 0 && <TalkTo present={present} addressee={addressee} onAddressee={onAddressee} />}
        <AnimatePresence mode="wait">
          {input.trim() && (
            <motion.span
              key={mode}
              initial={{ opacity: 0, y: 4, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-extrabold', chip.className)}
            >
              {chip.icon}
              {chip.label}
            </motion.span>
          )}
        </AnimatePresence>
        <span>Enter to send · Shift+Enter for a new line</span>
      </div>
    </form>
  )
}
