import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowLeft, Check, Loader2, Sparkles, X } from 'lucide-react'
import { GiMagicSwirl } from 'react-icons/gi'
import { WorldDraftSchema, type WorldDraftInput } from '@dnd/engine'
import { SECTION_TITLES, WIZARD_QUESTIONS, WIZARD_SECTIONS } from '@dnd/ai/wizard'
import type { DraftParts, WizardAnswers, WizardSection } from '../../../../shared/ipc'
import { cn, errorMessage } from '../../lib/util'
import { Button, IconButton, Input, spring } from '../../ui/controls'
import { WorldReview, type DraftUpdate } from './WorldReview'

// The World Wizard: a few questions, then the GM writes the world section by section, then the player edits
// and accepts it. The finished draft is validated here for quick feedback and again in main.

type Step = 'questions' | 'building' | 'review'
type SectionState = 'waiting' | 'working' | 'done' | 'failed'

const EMPTY_ANSWERS: WizardAnswers = { tone: '', tech: '', magic: '', threat: '', extra: '' }
const ALL_WAITING: Record<WizardSection, SectionState> = { overview: 'waiting', places: 'waiting', lore: 'waiting', power: 'waiting' }

/** Which card a validation problem belongs to, by the draft field it is about. */
const SECTION_OF: Record<string, WizardSection> = {
  name: 'overview',
  summary: 'overview',
  tone: 'overview',
  currencies: 'overview',
  start: 'places',
  regions: 'places',
  factions: 'places',
  gods: 'lore',
  races: 'lore',
  history: 'lore',
  powerSystem: 'power',
  rules: 'power',
}

function Questions({ answers, onChange }: { answers: WizardAnswers; onChange: (answers: WizardAnswers) => void }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {WIZARD_QUESTIONS.map((q, i) => (
        <motion.div
          key={q.id}
          data-testid="wizard-question"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.05 * i }}
          className="flex flex-col gap-2 rounded-3xl bg-white/90 p-4 shadow-md"
        >
          <p className="font-display text-lg font-bold text-indigo-950">{q.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {q.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={answers[q.id] === s}
                onClick={() => onChange({ ...answers, [q.id]: answers[q.id] === s ? '' : s })}
                className={cn(
                  'cursor-pointer rounded-full px-3 py-1 text-xs font-bold ring-1 transition-colors',
                  answers[q.id] === s ? 'bg-violet-500 text-white ring-violet-500' : 'bg-violet-50 text-violet-700 ring-violet-100 hover:bg-violet-100',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <Input value={answers[q.id]} maxLength={q.id === 'extra' ? 600 : 300} placeholder="Or in your own words…" aria-label={q.label} onChange={(e) => onChange({ ...answers, [q.id]: e.target.value })} />
        </motion.div>
      ))}
    </div>
  )
}

function Progress({ states }: { states: Record<WizardSection, SectionState> }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      {WIZARD_SECTIONS.map((s) => (
        <motion.div key={s} layout data-testid="wizard-progress" data-state={states[s]} className="flex items-center gap-3 rounded-2xl bg-white/90 px-4 py-3 shadow-sm">
          <span className="grid size-8 place-items-center rounded-full bg-violet-100 text-violet-600">
            {states[s] === 'done' ? (
              <Check className="size-4" />
            ) : states[s] === 'working' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : states[s] === 'failed' ? (
              <X className="size-4 text-rose-500" />
            ) : (
              <Sparkles className="size-4 opacity-40" />
            )}
          </span>
          <span className={cn('font-bold', states[s] === 'waiting' && 'text-indigo-300')}>{SECTION_TITLES[s]}</span>
        </motion.div>
      ))}
    </div>
  )
}

export function WorldWizard({ busy, onCancel, onAccept }: { busy: boolean; onCancel: () => void; onAccept: (draft: WorldDraftInput) => void }) {
  const [step, setStep] = useState<Step>('questions')
  const [answers, setAnswers] = useState<WizardAnswers>(EMPTY_ANSWERS)
  const [draft, setDraft] = useState<DraftParts>({})
  const [states, setStates] = useState<Record<WizardSection, SectionState>>(ALL_WAITING)
  const [regenerating, setRegenerating] = useState<WizardSection | null>(null)
  const [problems, setProblems] = useState<Partial<Record<WizardSection, string>>>({})

  const update: DraftUpdate = (change) => {
    setDraft(change)
    setProblems({})
  }

  /** Asks the GM for one section; returns the draft with it, or null if it failed. */
  const write = async (section: WizardSection, sofar: DraftParts): Promise<DraftParts | null> => {
    setStates((s) => ({ ...s, [section]: 'working' }))
    try {
      const result = await window.game.worldSection(answers, section, sofar)
      if (!result.ok) throw new Error(result.error)
      setStates((s) => ({ ...s, [section]: 'done' }))
      return { ...sofar, ...result.parts }
    } catch (err) {
      setStates((s) => ({ ...s, [section]: 'failed' }))
      toast.error(`${SECTION_TITLES[section]} could not be written`, { description: errorMessage(err) })
      return null
    }
  }

  /** Writes every section in order. `fresh` starts over; otherwise only the missing sections are written. */
  const build = async (fresh: boolean) => {
    setStep('building')
    let sofar = fresh ? {} : draft
    if (fresh) setStates(ALL_WAITING)
    for (const section of WIZARD_SECTIONS) {
      if (!fresh && states[section] === 'done') continue
      const next = await write(section, sofar)
      if (!next) return
      sofar = next
      setDraft(sofar)
    }
    setProblems({})
    setStep('review')
  }

  const regenerate = async (section: WizardSection) => {
    setRegenerating(section)
    const next = await write(section, draft)
    if (next) update(() => next)
    setRegenerating(null)
  }

  const accept = () => {
    const parsed = WorldDraftSchema.safeParse(draft)
    if (parsed.success) return onAccept(parsed.data)
    const issue = parsed.error.issues[0]!
    const section = SECTION_OF[String(issue.path[0])] ?? 'overview'
    setProblems({ [section]: `${issue.path.join(' › ') || 'world'}: ${issue.message}` })
    toast.error('The world is not finished yet', { description: issue.message })
  }

  return (
    <motion.div
      data-testid="world-wizard"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="scroll-fancy fixed inset-0 z-40 overflow-y-auto bg-linear-to-b from-violet-50 via-white to-pink-50 px-10 py-8"
    >
      <header className="mx-auto mb-6 flex max-w-5xl items-center gap-4">
        <span className="grid size-14 place-items-center rounded-3xl bg-linear-to-br from-fuchsia-400 to-indigo-600 text-3xl text-white shadow-lg">
          <GiMagicSwirl />
        </span>
        <div className="flex-1">
          <p className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">World Wizard</p>
          <h2 className="font-display text-3xl font-bold text-indigo-950">
            {step === 'questions' ? 'What world do you dream of?' : step === 'building' ? 'Your world is taking shape…' : draft.name || 'Your world'}
          </h2>
        </div>
        <IconButton label="Close the World Wizard" variant="ghost" icon={<X className="size-5" />} onClick={onCancel} />
      </header>

      <div className="mx-auto max-w-5xl">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={spring}>
            {step === 'questions' && <Questions answers={answers} onChange={setAnswers} />}
            {step === 'building' && <Progress states={states} />}
            {step === 'review' && <WorldReview draft={draft} update={update} busy={regenerating} problems={problems} onRegenerate={(s) => void regenerate(s)} />}
          </motion.div>
        </AnimatePresence>

        <footer className="mt-6 flex justify-between">
          {step === 'review' ? (
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep('questions')}>
              Change my answers
            </Button>
          ) : (
            <span />
          )}
          {step === 'questions' && (
            <Button size="lg" icon={<Sparkles className="size-5" />} onClick={() => void build(true)}>
              Build my world
            </Button>
          )}
          {step === 'building' && WIZARD_SECTIONS.some((s) => states[s] === 'failed') && (
            <Button size="lg" icon={<Sparkles className="size-5" />} onClick={() => void build(false)}>
              Try again
            </Button>
          )}
          {step === 'review' && (
            <Button size="lg" loading={busy} disabled={regenerating !== null} icon={<Check className="size-5" />} onClick={accept}>
              Begin in {draft.name || 'this world'}
            </Button>
          )}
        </footer>
      </div>
    </motion.div>
  )
}
