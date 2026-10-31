import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { PencilLine } from 'lucide-react'
import type { Campaign } from '@dnd/engine'
import type { PersonTarget } from '../../../../shared/ipc'
import { errorMessage } from '../../lib/util'
import { Button, Field, Input, Textarea } from '../../ui/controls'
import { Modal } from '../../ui/surfaces'

// Change who someone is after they were made: the hero or any character, in any save. The GM sees it next turn.

interface FieldSpec {
  key: string
  label: string
  max: number
  long?: boolean
  hint?: string
}

const LOOKS_HINT = 'New pictures follow this. Redraw the portrait to see it.'

const CHARACTER_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Name', max: 60, hint: 'Older lines that use the old name still find them.' },
  { key: 'role', label: 'Role', max: 80 },
  { key: 'description', label: 'Who they are', max: 600, long: true },
  { key: 'appearance', label: 'Looks', max: 400, long: true, hint: LOOKS_HINT },
  { key: 'personality', label: 'Personality', max: 400, long: true },
]

const HERO_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Name', max: 60 },
  { key: 'pronouns', label: 'Pronouns', max: 30 },
  { key: 'background', label: 'Background', max: 600, long: true },
  { key: 'appearance', label: 'Looks', max: 400, long: true, hint: LOOKS_HINT },
]

function currentValues(campaign: Campaign, target: PersonTarget): Record<string, string> {
  if (target.kind === 'hero') {
    const { name, pronouns, background, appearance } = campaign.player
    return { name, pronouns, background, appearance }
  }
  const c = campaign.characters.find((x) => x.id === target.id)
  return c ? { name: c.name, role: c.role, description: c.description, appearance: c.appearance, personality: c.personality } : {}
}

interface EditPersonProps {
  campaign: Campaign
  target: PersonTarget
  onChange: (campaign: Campaign) => void
}

export function EditPersonButton({ campaign, target, onChange }: EditPersonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="secondary" icon={<PencilLine className="size-4" />} onClick={() => setOpen(true)} data-testid="edit-person">
        Edit details
      </Button>
      {open && <EditPersonDialog campaign={campaign} target={target} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

function EditPersonDialog({ campaign, target, onChange, onClose }: EditPersonProps & { onClose: () => void }) {
  const [initial] = useState(() => currentValues(campaign, target))
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState(false)
  const fields = target.kind === 'hero' ? HERO_FIELDS : CHARACTER_FIELDS
  const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== initial[key]))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (Object.keys(changed).length === 0) return onClose()
    setBusy(true)
    try {
      onChange(await window.game.editPerson(campaign.id, target, changed))
      toast.success(`Saved ${values.name?.trim() ?? ''}`)
      onClose()
    } catch (err) {
      toast.error('That change could not be saved', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${initial.name ?? ''}`} icon={<PencilLine />}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4" data-testid="edit-person-form">
        {fields.map((f) => {
          const props = { value: values[f.key] ?? '', maxLength: f.max, onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.key]: e.target.value })) }
          return (
            <Field key={f.key} label={f.label} hint={f.hint}>
              {f.long ? <Textarea rows={3} {...props} /> : <Input {...props} />}
            </Field>
          )
        })}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!values.name?.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
