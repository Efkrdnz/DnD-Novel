import { AnimatePresence, motion } from 'motion/react'
import { presentCharacters, type Campaign } from '@dnd/engine'
import { cn } from '../../lib/util'
import { AspectBars, BondBadge, HoverCard } from '../../ui/game'
import { Portrait } from '../../ui/portrait'

interface Props {
  campaign: Campaign
  /** Id of the character speaking right now (or last). */
  speakingId: string | null
  addressee: string | null
  onAddress: (characterId: string | null) => void
}

/** Who is in the scene with you. The speaker lights up; click someone to talk to them. */
export function SceneStrip({ campaign, speakingId, addressee, onAddress }: Props) {
  const present = presentCharacters(campaign)
  if (present.length === 0) return null

  return (
    <div className="flex items-center gap-3 border-b border-white/70 bg-linear-to-r from-[#fff8ea]/80 via-white/50 to-violet-50/60 px-5 py-2.5">
      <span className="text-[10px] font-extrabold tracking-widest text-gilt-deep uppercase">In the scene</span>
      <ul data-testid="scene-strip" className="flex flex-1 flex-wrap items-end gap-3 pt-1">
        <AnimatePresence initial={false}>
          {present.map((character) => {
            const relation = campaign.relations.find((r) => r.characterId === character.id)
            const selected = addressee === character.id
            return (
              <motion.li key={character.id} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
                <HoverCard
                  side="bottom"
                  card={
                    <div className="flex flex-col gap-2">
                      <p className="font-display font-bold">
                        {character.name}
                        {character.role && <span className="ml-2 font-sans text-xs font-bold text-indigo-400">{character.role}</span>}
                      </p>
                      <span className="flex gap-1">
                        <BondBadge relation={relation} />
                        {character.companion && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-extrabold text-amber-700 ring-1 ring-amber-200">Companion</span>}
                      </span>
                      {relation ? <AspectBars relation={relation} /> : <p className="text-xs text-indigo-500">No feelings recorded yet.</p>}
                      {relation?.summary && <p className="text-xs text-indigo-950 italic">“{relation.summary}”</p>}
                      <p className="text-[11px] font-bold text-violet-500">{selected ? 'Click to stop talking to them' : 'Click to talk to them'}</p>
                    </div>
                  }
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Talk to ${character.name}`}
                    onClick={() => onAddress(selected ? null : character.id)}
                    className={cn(
                      'flex cursor-pointer flex-col items-center gap-0.5 rounded-2xl px-1.5 py-1 transition-colors',
                      selected ? 'bg-white shadow-md ring-2 ring-violet-300' : 'hover:bg-white/70',
                    )}
                  >
                    <Portrait name={character.name} size="sm" speaking={speakingId === character.id} art={character.portrait} />
                    <span className={cn('max-w-20 truncate text-[11px] font-extrabold', speakingId === character.id ? 'text-gilt-deep' : 'text-indigo-700/80')}>
                      {character.name}
                    </span>
                  </button>
                </HoverCard>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )
}
