import type { CompanionDraft } from '@dnd/engine'
import { Input, Textarea } from '../../ui/controls'

// The editable fields of a starting companion (the bond is picked on the card).

export const BLANK_COMPANION: CompanionDraft = { name: '', role: '', description: '', appearance: '', personality: '', bond: 'childhood-friend' }

export function CompanionEditor({ value, onChange }: { value: CompanionDraft; onChange: (value: CompanionDraft) => void }) {
  const set = (key: keyof Omit<CompanionDraft, 'bond'>) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value })
  return (
    <div className="flex flex-col gap-1.5" data-testid="companion-editor">
      <Input value={value.name} onChange={set('name')} maxLength={60} placeholder="Name" aria-label="Companion name" autoFocus={!value.name} className="py-1.5" />
      <Input value={value.role} onChange={set('role')} maxLength={80} placeholder="Role, e.g. exiled knight" aria-label="Companion role" className="py-1.5 text-sm" />
      <Textarea value={value.description} onChange={set('description')} maxLength={600} rows={2} placeholder="Who they are" aria-label="Companion description" className="py-1.5 text-sm" />
      <Textarea value={value.appearance} onChange={set('appearance')} maxLength={400} rows={2} placeholder="How they look" aria-label="Companion appearance" className="py-1.5 text-sm" />
      <Input value={value.personality} onChange={set('personality')} maxLength={400} placeholder="Personality" aria-label="Companion personality" className="py-1.5 text-sm" />
    </div>
  )
}
