import { motion } from 'motion/react'
import { GiQuillInk } from 'react-icons/gi'
import type { Campaign } from '@dnd/engine'
import { spring } from '../../ui/controls'

// Step 0 of character setup, in worlds that come with preset heroes: play one of them (and edit it), or start blank.

export type WorldHero = Campaign['world']['heroes'][number]

export function HeroChoice({ campaign, onPick }: { campaign: Campaign; onPick: (hero: WorldHero | null) => void }) {
  const { heroes, powerSystem } = campaign.world
  const sourceName = (id: string | null) => (id ? (powerSystem?.sources.find((s) => s.id === id || s.name === id)?.name ?? id) : null)

  return (
    <motion.div key="hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} className="mx-auto grid max-w-4xl grid-cols-3 gap-3">
      {heroes.map((hero, i) => {
        const tags = [hero.identity.pronouns, hero.archetype, sourceName(hero.identity.powerSource), hero.companions.length ? `+${hero.companions.length} companion${hero.companions.length > 1 ? 's' : ''}` : '']
        return (
          <motion.button
            key={hero.id}
            type="button"
            data-testid="hero-choice"
            data-hero={hero.id}
            onClick={() => onPick(hero)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.04 * i }}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            className="flex cursor-pointer flex-col gap-2 rounded-3xl bg-white/90 p-4 text-left shadow-md ring-2 ring-transparent hover:ring-pink-300"
          >
            {hero.portrait && (
              <img src={hero.portrait} alt={hero.identity.name} className="h-32 w-full rounded-2xl object-cover" />
            )}
            <span className="font-display text-xl font-bold text-indigo-950">{hero.identity.name}</span>
            <span className="line-clamp-4 text-sm text-indigo-800/75">{hero.identity.background || hero.identity.appearance || 'A hero of this world.'}</span>
            <span className="mt-auto flex flex-wrap gap-1">
              {tags.filter(Boolean).map((t) => (
                <span key={t} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-extrabold text-violet-700 ring-1 ring-violet-100">
                  {t}
                </span>
              ))}
            </span>
          </motion.button>
        )
      })}
      <motion.button
        type="button"
        data-testid="hero-choice"
        data-hero="own"
        onClick={() => onPick(null)}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.04 * heroes.length }}
        whileHover={{ y: -4 }}
        whileTap={{ scale: 0.98 }}
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-violet-300 bg-white/60 p-4 text-center text-violet-700 hover:bg-white/90"
      >
        <GiQuillInk className="size-8" />
        <span className="font-display text-xl font-bold">Create my own</span>
        <span className="text-xs text-indigo-700/70">Start from a blank page.</span>
      </motion.button>
    </motion.div>
  )
}
