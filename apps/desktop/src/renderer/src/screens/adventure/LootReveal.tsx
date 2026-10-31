import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { GiLockedChest, GiOpenChest } from 'react-icons/gi'
import type { InventoryItem, Rarity } from '@dnd/engine'
import { cn } from '../../lib/util'
import { Button } from '../../ui/controls'
import { ItemTile, RARITY_STYLE } from '../../ui/game'

export interface Loot {
  item: InventoryItem
  quantity: number
  merged: boolean
}

/** The light that pours out of the chest, in the item's rarity colour. */
const BEAM: Record<Rarity, string> = {
  common: '#cbd5e1',
  uncommon: '#6ee7b7',
  rare: '#7dd3fc',
  epic: '#d8b4fe',
  legendary: '#fcd34d',
  mythic: '#f9a8d4',
}

const GRAND: Rarity[] = ['legendary', 'mythic']
const SPARKS = 14
type Phase = 'shake' | 'open' | 'show'

/** A chest opens and the item rises out of it. One item at a time; "Take it" (or Enter) shows the next. */
export function LootReveal({ queue, total, onTake }: { queue: Loot[]; total: number; onTake: () => void }) {
  const loot = queue[0]
  const index = total - queue.length + 1
  return <AnimatePresence>{loot && <Reveal key={`${loot.item.id}-${index}`} loot={loot} index={index} total={total} onTake={onTake} />}</AnimatePresence>
}

function Reveal({ loot, index, total, onTake }: { loot: Loot; index: number; total: number; onTake: () => void }) {
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>(reduced ? 'show' : 'shake')
  const { item } = loot
  const rarity = RARITY_STYLE[item.rarity]
  const grand = GRAND.includes(item.rarity)

  useEffect(() => {
    if (reduced) return
    const open = setTimeout(() => setPhase('open'), 650)
    const show = setTimeout(() => setPhase('show'), 1050)
    return () => {
      clearTimeout(open)
      clearTimeout(show)
    }
  }, [reduced])

  return (
    <motion.div
      data-testid="loot-reveal"
      role="dialog"
      aria-label={`You found ${item.name}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => phase === 'show' && onTake()}
      className="absolute inset-0 z-30 grid place-items-center overflow-hidden bg-indigo-950/45 backdrop-blur-[3px]"
    >
      <div className="relative flex w-[26rem] max-w-[90%] flex-col items-center">
        {/* Light beams */}
        <motion.div
          aria-hidden
          className="absolute top-2 size-[30rem] rounded-full"
          style={{
            background: `repeating-conic-gradient(from 0deg, ${BEAM[item.rarity]}cc 0deg 8deg, transparent 8deg 24deg)`,
            maskImage: 'radial-gradient(circle, #000 0%, transparent 65%)',
          }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={phase === 'shake' ? { opacity: 0, scale: 0.4 } : { opacity: grand ? 1 : 0.75, scale: 1, rotate: 360 }}
          transition={{ opacity: { duration: 0.4 }, scale: { duration: 0.5 }, rotate: { duration: grand ? 14 : 22, repeat: Infinity, ease: 'linear' } }}
        />

        {/* Chest, then the item rising out of it */}
        <div className="relative grid h-36 place-items-center">
          <AnimatePresence mode="wait">
            {phase !== 'show' ? (
              <motion.span
                key={phase}
                className="text-8xl text-amber-700 drop-shadow-[0_6px_10px_rgb(0_0_0_/_0.35)]"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={phase === 'shake' ? { scale: 1, opacity: 1, rotate: [0, -6, 6, -4, 4, 0] } : { scale: 1.08, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0, y: 20 }}
                transition={{ duration: 0.5 }}
              >
                {phase === 'shake' ? <GiLockedChest /> : <GiOpenChest />}
              </motion.span>
            ) : (
              <motion.div key="item" initial={{ y: 50, scale: 0.3, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
                <ItemTile item={item} size="lg" />
              </motion.div>
            )}
          </AnimatePresence>
          {grand && phase === 'show' && <Sparks color={BEAM[item.rarity]} />}
        </div>

        {/* Name plate and details */}
        <AnimatePresence>
          {phase === 'show' && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="parchment relative mt-4 flex w-full flex-col items-center gap-2 rounded-[26px] px-6 py-5 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <p className={cn('text-[11px] font-extrabold tracking-[0.25em] uppercase', rarity.text)}>
                {rarity.label} {item.type}
              </p>
              <h2 className="font-display text-2xl font-bold text-[#3b2f24]">{item.name}</h2>
              <p className="text-sm font-extrabold text-emerald-700">
                +{loot.quantity}
                {loot.merged && <span className="text-emerald-700/70"> (now {item.quantity})</span>}
              </p>
              <p className="font-dialogue text-[0.98rem] leading-snug text-[#3b2f24]/90">{item.description}</p>
              {item.stats.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {item.stats.map((stat) => (
                    <span key={stat.name} className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-100">
                      {stat.name} {stat.value >= 0 ? `+${stat.value}` : stat.value}
                    </span>
                  ))}
                </div>
              )}
              {item.effects.length > 0 && <p className="text-xs font-semibold text-violet-700">{item.effects.join(' · ')}</p>}
              <div className="mt-1 flex items-center gap-3">
                {total > 1 && (
                  <span className="text-xs font-bold text-[#3b2f24]/60">
                    {index} of {total}
                  </span>
                )}
                {/* Autofocused, so Enter takes the item. */}
                <Button size="sm" onClick={onTake} autoFocus>
                  {index < total ? 'Take it · next' : 'Take it'}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function Sparks({ color }: { color: string }) {
  return (
    <>
      {Array.from({ length: SPARKS }, (_, i) => {
        const angle = (i / SPARKS) * Math.PI * 2
        const distance = 90 + (i % 3) * 22
        return (
          <motion.span
            key={i}
            aria-hidden
            className="absolute size-2.5 rounded-full"
            style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, opacity: 0, scale: 0.3 }}
            transition={{ duration: 1.1, delay: (i % 4) * 0.05, ease: 'easeOut' }}
          />
        )
      })}
    </>
  )
}
