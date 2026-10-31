import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Plus, Smile, X } from 'lucide-react'
import { MAX_CUSTOM_FACES, type Campaign } from '@dnd/engine'
import { errorMessage } from '../../lib/util'
import { Button, Input, Toggle } from '../../ui/controls'

// Custom expressions for visual novel play: a name and how the face looks. Every character's face for one is drawn
// from their portrait the first time they show it. The GM may add its own unless the player turns that off.

export function ExpressionsCard({ campaign, onChange }: { campaign: Campaign; onChange: (campaign: Campaign) => void }) {
  const { customFaces, gmFaces } = campaign.presentation
  const [name, setName] = useState('')
  const [look, setLook] = useState('')
  const [busy, setBusy] = useState(false)
  const full = customFaces.length >= MAX_CUSTOM_FACES

  const run = async (task: () => Promise<Campaign>, success?: string) => {
    setBusy(true)
    try {
      onChange(await task())
      if (success) toast.success(success)
      return true
    } catch (err) {
      toast.error('That did not work', { description: errorMessage(err) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const added = await run(() => window.game.addExpression(campaign.id, { name, look }), `${name.trim()} added. Faces for it are drawn the first time someone shows it.`)
    if (added) {
      setName('')
      setLook('')
    }
  }

  return (
    <section data-testid="expressions" className="flex flex-col gap-3 rounded-3xl bg-white/85 p-5 shadow-sm ring-1 ring-white">
      <h3 className="flex items-center gap-2 text-[11px] font-extrabold tracking-widest text-indigo-400 uppercase">
        <Smile className="size-4" /> Expressions
      </h3>
      <p className="text-xs text-indigo-800/70">
        Faces beyond the built-in emotions, for every character. A face is drawn from each portrait the first time someone shows it.
      </p>
      {customFaces.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {customFaces.map((face) => (
            <li key={face.id} data-testid="expression" data-id={face.id} title={face.look} className="flex items-center gap-1 rounded-full bg-violet-50 py-1 pr-1 pl-3 text-sm font-bold text-violet-700 ring-1 ring-violet-100">
              {face.name}
              <button
                type="button"
                aria-label={`Remove ${face.name}`}
                disabled={busy}
                onClick={() => void run(() => window.game.removeExpression(campaign.id, face.id))}
                className="grid size-5 cursor-pointer place-items-center rounded-full text-violet-400 hover:bg-violet-100 hover:text-violet-700"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-center gap-2">
        <Input value={name} maxLength={24} placeholder="Name, e.g. Lovestruck" aria-label="Expression name" onChange={(e) => setName(e.target.value)} className="w-44 py-1.5" />
        <Input value={look} maxLength={160} placeholder="How the face looks, e.g. heart-shaped pupils, dreamy smile" aria-label="How the face looks" onChange={(e) => setLook(e.target.value)} className="min-w-60 flex-1 py-1.5" />
        <Button type="submit" size="sm" icon={<Plus className="size-4" />} disabled={busy || full || !name.trim() || !look.trim()}>
          Add
        </Button>
      </form>
      {full && <p className="text-xs font-semibold text-amber-700">That is the most a story can have ({MAX_CUSTOM_FACES}). Remove one to add another.</p>}
      <Toggle checked={gmFaces} onChange={(on) => void run(() => window.game.setPresentation(campaign.id, { gmFaces: on }))} label="Let the GM invent new expressions" />
    </section>
  )
}
