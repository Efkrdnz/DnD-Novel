import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { KeyRound, Plug, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { GiCrystalBall } from 'react-icons/gi'
import { KIND_INFO, type ConnectionKind } from '@dnd/ai/kinds'
import type { Connection } from '../../../../shared/settings'
import { modelForTest, ProviderIcon } from '../../lib/providers'
import { useSettings } from '../../lib/settings'
import { errorMessage } from '../../lib/util'
import { Button, IconButton, PasswordInput, spring } from '../../ui/controls'
import { Card, EmptyState, Modal, SectionTitle, StatusPill, type PillState } from '../../ui/surfaces'
import { AddConnectionModal, saveConnection } from './AddConnectionModal'

const SUBSCRIPTIONS = [
  { kind: 'claude-code' as const, title: 'Use my Claude subscription', model: 'sonnet' },
  { kind: 'codex' as const, title: 'Use my ChatGPT subscription', model: '' },
]

export function ConnectionsTab() {
  const ctx = useSettings()
  const [adding, setAdding] = useState<{ kind?: ConnectionKind } | null>(null)
  const [removing, setRemoving] = useState<Connection | null>(null)
  if (!ctx.view) return null
  const { settings, clis } = ctx.view

  const quick = SUBSCRIPTIONS.filter(
    (s) => (s.kind === 'claude-code' ? clis.claude : clis.codex) && !settings.connections.some((c) => c.kind === s.kind),
  )

  const quickAdd = async (kind: 'claude-code' | 'codex', model: string) => {
    try {
      const { id } = await saveConnection(ctx, { kind, label: KIND_INFO[kind].name, baseUrl: '', apiKey: '', addToChain: true, model })
      toast.promise(window.game.testConnection(id, model), {
        loading: `Waking ${KIND_INFO[kind].name}…`,
        success: (r) => (r.ok ? `${KIND_INFO[kind].name} is ready!` : `Added, but the test failed: ${r.error}`),
        error: (err) => errorMessage(err),
      })
    } catch (err) {
      toast.error('Could not add the connection', { description: errorMessage(err) })
    }
  }

  const remove = async (connection: Connection) => {
    setRemoving(null)
    try {
      await ctx.commit((s) => ({ ...s, connections: s.connections.filter((c) => c.id !== connection.id) }))
      toast.success(`${connection.label} removed`)
    } catch (err) {
      toast.error('Could not remove it', { description: errorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <AnimatePresence>
        {quick.length > 0 && (
          <Card exit={{ opacity: 0, scale: 0.97 }} className="ring-2 ring-emerald-200">
            <SectionTitle icon={<Zap className="size-5" />} tone="mint" title="Found on this PC" subtitle="One click and your Game Master runs on a plan you already pay for." />
            <div className="grid gap-3 md:grid-cols-2">
              {quick.map((q) => (
                <motion.button
                  key={q.kind}
                  type="button"
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  onClick={() => void quickAdd(q.kind, q.model)}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/90 p-4 text-left shadow-md shadow-emerald-100 ring-1 ring-emerald-100 hover:ring-emerald-300"
                >
                  <ProviderIcon kind={q.kind} />
                  <span>
                    <span className="block font-extrabold">{q.title}</span>
                    <span className="block text-xs text-indigo-700/70">{KIND_INFO[q.kind].blurb}</span>
                  </span>
                </motion.button>
              ))}
            </div>
          </Card>
        )}
      </AnimatePresence>

      <Card>
        <SectionTitle
          icon={<Plug className="size-5" />}
          title="Connections"
          subtitle="Where your Game Master's mind lives. API keys are encrypted on this PC."
          action={
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding({})}>
              Add
            </Button>
          }
        />
        {settings.connections.length === 0 ? (
          <EmptyState icon={<GiCrystalBall />} title="No connections yet">
            Add your Claude or ChatGPT subscription, an API key (Claude, Gemini, OpenAI, Groq, OpenRouter), or a local Ollama.
          </EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <AnimatePresence initial={false}>
              {settings.connections.map((connection) => (
                <ConnectionCard key={connection.id} connection={connection} onRemove={() => setRemoving(connection)} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </Card>

      <AddConnectionModal open={adding !== null} initialKind={adding?.kind} onClose={() => setAdding(null)} />

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={`Remove ${removing?.label ?? ''}?`} icon={<Trash2 className="size-5" />}>
        <p className="text-indigo-800/80">It leaves the Game Master's chain and its saved key is deleted. Your adventures are not affected.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            Keep it
          </Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => removing && void remove(removing)}>
            Remove
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function ConnectionCard({ connection, onRemove }: { connection: Connection; onRemove: () => void }) {
  const ctx = useSettings()
  const [test, setTest] = useState<{ state: PillState; text: string }>({ state: 'idle', text: 'Not tested yet' })
  const [editingKey, setEditingKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  if (!ctx.view) return null
  const { settings, keys, clis } = ctx.view
  const info = KIND_INFO[connection.kind]
  const rank = settings.routes.gm.findIndex((e) => e.connectionId === connection.id)
  const key = keys[connection.id]
  const cliPath = connection.kind === 'claude-code' ? clis.claude : connection.kind === 'codex' ? clis.codex : null

  const runTest = async () => {
    setTest({ state: 'testing', text: 'Knocking on the tower door…' })
    try {
      const model = await modelForTest(connection, settings)
      const result = await window.game.testConnection(connection.id, model)
      setTest(
        result.ok
          ? { state: 'ok', text: `${(result.latencyMs / 1000).toFixed(1)}s · “${result.sample}”` }
          : { state: 'error', text: result.error },
      )
    } catch (err) {
      setTest({ state: 'error', text: errorMessage(err) })
    }
  }

  const saveKey = async () => {
    try {
      ctx.applyStatus(await window.game.setApiKey(connection.id, keyDraft))
      setEditingKey(false)
      setKeyDraft('')
      toast.success('Key saved and encrypted')
    } catch (err) {
      toast.error('Key not saved', { description: errorMessage(err) })
    }
  }

  const rescan = async () => {
    ctx.applyStatus(await window.game.detectClis())
  }

  let status: string
  if (info.auth === 'subscription') status = cliPath ? 'Found on this PC' : 'Not found on this PC'
  else if (info.auth === 'none') status = connection.baseUrl || info.defaultBaseUrl || ''
  else status = key?.hasKey ? `Key ••••${key.hint}` : info.auth === 'apiKey' ? 'No key yet' : 'No key (optional)'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={spring}
      className="flex flex-col gap-3 rounded-3xl bg-white/85 p-4 shadow-md shadow-indigo-100 ring-1 ring-white"
    >
      <div className="flex items-center gap-3">
        <ProviderIcon kind={connection.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-extrabold">{connection.label}</span>
            {rank >= 0 && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-extrabold text-violet-700">GM #{rank + 1}</span>
            )}
          </div>
          <span className="block truncate text-xs font-semibold text-indigo-700/60">
            {info.name} · {status}
          </span>
        </div>
        <IconButton label="Remove" icon={<Trash2 className="size-4" />} onClick={onRemove} className="text-rose-400 hover:text-rose-600" />
      </div>

      <AnimatePresence>
        {editingKey && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex gap-2 overflow-hidden">
            <div className="flex-1">
              <PasswordInput value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="Paste the new key" autoFocus />
            </div>
            <Button size="sm" className="h-auto" disabled={!keyDraft.trim()} onClick={() => void saveKey()}>
              Save
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <StatusPill state={test.state}>{test.text}</StatusPill>
        </div>
        {info.auth === 'subscription' && !cliPath && (
          <IconButton label="Look again" icon={<RefreshCw className="size-4" />} onClick={() => void rescan()} />
        )}
        {(info.auth === 'apiKey' || info.auth === 'optionalKey') && (
          <IconButton label={key?.hasKey ? 'Replace key' : 'Add key'} icon={<KeyRound className="size-4" />} onClick={() => setEditingKey((v) => !v)} />
        )}
        <Button size="sm" variant="secondary" loading={test.state === 'testing'} onClick={() => void runTest()}>
          Test
        </Button>
      </div>
      {info.auth === 'subscription' && (
        <p className="text-xs font-semibold text-indigo-700/60">
          Uses your own subscription{connection.kind === 'claude-code' ? ' (its Agent SDK credit)' : ''}. For your own use only.
        </p>
      )}
    </motion.div>
  )
}
