import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Check, ExternalLink, RefreshCw, Sparkles, Star } from 'lucide-react'
import { CONNECTION_KINDS, isCliKind, KIND_INFO, type ConnectionKind } from '@dnd/ai/kinds'

/** Gemini is the main provider: fast native tool calls at a low price. */
const RECOMMENDED_KIND: ConnectionKind = 'google'
const KIND_ORDER = [RECOMMENDED_KIND, ...CONNECTION_KINDS.filter((k) => k !== RECOMMENDED_KIND)]
import type { Connection, Settings, SettingsView } from '../../../../shared/settings'
import { modelForTest, pickDefaultModel, ProviderIcon } from '../../lib/providers'
import { useSettings } from '../../lib/settings'
import { cn, errorMessage, newId } from '../../lib/util'
import { Button, Field, Input, PasswordInput, spring, Toggle } from '../../ui/controls'
import { Modal, StatusPill, type PillState } from '../../ui/surfaces'

export interface ConnectionDraft {
  kind: ConnectionKind
  label: string
  baseUrl: string
  apiKey: string
  addToChain: boolean
  model: string
}

interface SettingsActions {
  commit: (change: (settings: Settings) => Settings) => Promise<SettingsView>
  applyStatus: (view: SettingsView) => void
}

/**
 * Saves a connection (and its key), optionally appends it to the GM chain, and picks a model
 * from the live list when an HTTP connection has none. Returns the connection id.
 */
export async function saveConnection(ctx: SettingsActions, draft: ConnectionDraft, existingId?: string) {
  const id = existingId ?? newId()
  const connection: Connection = {
    id,
    kind: draft.kind,
    label: draft.label.trim() || KIND_INFO[draft.kind].name,
    baseUrl: draft.baseUrl.trim(),
  }
  let view = await ctx.commit((s) => ({
    ...s,
    connections: s.connections.some((c) => c.id === id)
      ? s.connections.map((c) => (c.id === id ? connection : c))
      : [...s.connections, connection],
    routes: {
      ...s.routes,
      gm:
        draft.addToChain && !s.routes.gm.some((e) => e.connectionId === id)
          ? [...s.routes.gm, { connectionId: id, model: draft.model.trim() }]
          : s.routes.gm,
    },
  }))

  if (draft.apiKey.trim()) {
    view = await window.game.setApiKey(id, draft.apiKey)
    ctx.applyStatus(view)
  }

  const entry = view.settings.routes.gm.find((e) => e.connectionId === id)
  if (entry && !entry.model && !isCliKind(draft.kind)) {
    try {
      const model = pickDefaultModel(draft.kind, await window.game.listModels(id))
      if (model) {
        view = await ctx.commit((s) => ({
          ...s,
          routes: { ...s.routes, gm: s.routes.gm.map((e) => (e.connectionId === id && !e.model ? { ...e, model } : e)) },
        }))
      }
    } catch {
      // The connection test that follows explains what is wrong (bad key, server down…).
    }
  }
  return { id, view }
}

const emptyDraft = (kind: ConnectionKind): ConnectionDraft => ({
  kind,
  label: KIND_INFO[kind].name,
  baseUrl: '',
  apiKey: '',
  addToChain: true,
  model: KIND_INFO[kind].suggestedModels[0] ?? '',
})

export function AddConnectionModal({ open, onClose, initialKind }: { open: boolean; onClose: () => void; initialKind?: ConnectionKind }) {
  const ctx = useSettings()
  const [draft, setDraft] = useState<ConnectionDraft | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [test, setTest] = useState<{ state: PillState; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(initialKind ? emptyDraft(initialKind) : null)
    setSavedId(null)
    setTest(null)
  }, [open, initialKind])

  const patch = (change: Partial<ConnectionDraft>) => setDraft((d) => (d ? { ...d, ...change } : d))

  const submit = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const { id, view } = await saveConnection(ctx, draft, savedId ?? undefined)
      setSavedId(id)
      setTest({ state: 'testing', text: 'Knocking on the tower door…' })
      const connection = view.settings.connections.find((c) => c.id === id)!
      const result = await window.game.testConnection(id, await modelForTest(connection, view.settings))
      setTest(
        result.ok
          ? { state: 'ok', text: `Answered in ${(result.latencyMs / 1000).toFixed(1)}s: “${result.sample}”` }
          : { state: 'error', text: result.error },
      )
    } catch (err) {
      setTest({ state: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const title = draft ? `Connect ${KIND_INFO[draft.kind].name}` : 'Add a connection'

  return (
    <Modal open={open} onClose={onClose} title={title} icon={<Sparkles className="size-5" />} wide={!draft}>
      <AnimatePresence mode="wait">
        {!draft ? (
          <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }}>
            <KindPicker onPick={(kind) => setDraft(emptyDraft(kind))} />
          </motion.div>
        ) : test?.state === 'ok' ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 py-4 text-center">
            <SuccessBurst />
            <p className="text-lg font-extrabold">Your Game Master is awake!</p>
            <StatusPill state="ok">{test.text}</StatusPill>
            <Button onClick={onClose} icon={<Check className="size-4" />}>
              Done
            </Button>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-4">
            <DraftForm draft={draft} onChange={patch} />
            {test && <StatusPill state={test.state}>{test.text}</StatusPill>}
            <div className="mt-2 flex items-center gap-2">
              {!savedId && !initialKind && (
                <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setDraft(null)}>
                  Back
                </Button>
              )}
              <span className="flex-1" />
              {test?.state === 'error' && (
                <Button variant="ghost" onClick={onClose}>
                  Keep it anyway
                </Button>
              )}
              <Button loading={busy} onClick={() => void submit()} disabled={KIND_INFO[draft.kind].baseUrl === 'required' && !draft.baseUrl.trim()}>
                {savedId ? 'Save & test again' : 'Save & test'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}

function KindPicker({ onPick }: { onPick: (kind: ConnectionKind) => void }) {
  const { view } = useSettings()
  return (
    <motion.div
      className="grid grid-cols-3 gap-3"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.03 } } }}
    >
      {KIND_ORDER.map((kind) => {
        const info = KIND_INFO[kind]
        const found = kind === 'claude-code' ? view?.clis.claude : kind === 'codex' ? view?.clis.codex : undefined
        const recommended = kind === RECOMMENDED_KIND
        return (
          <motion.button
            key={kind}
            type="button"
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onPick(kind)}
            className={cn(
              'flex cursor-pointer flex-col gap-2 rounded-3xl bg-white/85 p-4 text-left shadow-sm transition-shadow hover:shadow-md hover:shadow-indigo-100 hover:ring-violet-200',
              recommended ? 'ring-2 ring-amber-300' : 'ring-1 ring-white',
            )}
          >
            <div className="flex items-center justify-between">
              <ProviderIcon kind={kind} />
              {recommended && (
                <span className="flex items-center gap-1 rounded-full bg-linear-to-br from-amber-300 to-orange-400 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm">
                  <Star className="size-3" fill="currentColor" /> Recommended
                </span>
              )}
              {info.auth === 'subscription' && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-extrabold', found ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-400')}>
                  {found ? 'Found' : 'Not installed'}
                </span>
              )}
              {info.auth === 'none' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">Free</span>}
            </div>
            <span className="font-extrabold">{info.name}</span>
            <span className="text-xs text-indigo-700/70">{info.blurb}</span>
          </motion.button>
        )
      })}
    </motion.div>
  )
}

function DraftForm({ draft, onChange }: { draft: ConnectionDraft; onChange: (change: Partial<ConnectionDraft>) => void }) {
  const ctx = useSettings()
  const info = KIND_INFO[draft.kind]
  const cliPath = draft.kind === 'claude-code' ? ctx.view?.clis.claude : draft.kind === 'codex' ? ctx.view?.clis.codex : undefined

  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl bg-white/70 p-3">
        <ProviderIcon kind={draft.kind} size="lg" />
        <p className="text-sm text-indigo-800/80">{info.blurb}</p>
      </div>

      <Field label="Name">
        <Input value={draft.label} maxLength={40} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>

      {info.auth === 'subscription' && (
        <div className={cn('flex items-center gap-3 rounded-2xl p-3 text-sm', cliPath ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
          <span className="flex-1 font-semibold break-all">
            {cliPath ? `Found: ${cliPath}` : `${draft.kind === 'claude-code' ? 'Claude Code' : 'Codex'} was not found. Install it and sign in, then look again.`}
          </span>
          {!cliPath && (
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={async () => ctx.applyStatus(await window.game.detectClis())}>
              Look again
            </Button>
          )}
        </div>
      )}

      {(info.auth === 'apiKey' || info.auth === 'optionalKey') && (
        <Field
          label={info.auth === 'apiKey' ? 'API key' : 'API key (optional)'}
          hint={
            <span className="flex items-center gap-2">
              Encrypted with Windows and never shown again.
              {info.keyUrl && (
                <a href={info.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-violet-600 hover:underline">
                  Get a key <ExternalLink className="size-3" />
                </a>
              )}
            </span>
          }
        >
          <PasswordInput value={draft.apiKey} onChange={(e) => onChange({ apiKey: e.target.value })} placeholder="Paste your key" />
        </Field>
      )}

      {info.baseUrl !== 'none' && (
        <Field label="Server URL" hint={info.baseUrl === 'optional' ? `Leave empty for ${info.defaultBaseUrl}` : 'For example http://127.0.0.1:1234/v1'}>
          <Input value={draft.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} placeholder={info.defaultBaseUrl ?? 'https://…'} />
        </Field>
      )}

      <div className="flex items-center gap-3 rounded-2xl bg-white/70 p-3">
        <Toggle checked={draft.addToChain} onChange={(addToChain) => onChange({ addToChain })} label="Use for the Game Master" />
        <span className="flex-1 text-sm font-bold">Let the Game Master use this</span>
      </div>

      {draft.addToChain && (
        <Field label="Model" hint={info.suggestedModels.length ? undefined : isCliKind(draft.kind) ? 'Empty = the CLI default' : 'Empty = picked for you'}>
          <Input
            value={draft.model}
            list={`models-${draft.kind}`}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder={isCliKind(draft.kind) ? 'Default' : 'Picked automatically'}
          />
          <datalist id={`models-${draft.kind}`}>
            {info.suggestedModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
      )}
    </>
  )
}

function SuccessBurst() {
  return (
    <div className="relative grid size-24 place-items-center">
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2
        return (
          <motion.span
            key={i}
            className="absolute size-2.5 rotate-45 rounded-[2px] bg-linear-to-br from-amber-300 to-pink-400"
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
            animate={{ x: Math.cos(angle) * 46, y: Math.sin(angle) * 46, opacity: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: 'easeOut', delay: 0.1 }}
          />
        )
      })}
      <motion.span
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ ...spring, stiffness: 300 }}
        className="grid size-16 place-items-center rounded-full bg-linear-to-br from-emerald-400 to-teal-500 text-white shadow-lg shadow-emerald-200"
      >
        <Check className="size-8" strokeWidth={3} />
      </motion.span>
    </div>
  )
}
