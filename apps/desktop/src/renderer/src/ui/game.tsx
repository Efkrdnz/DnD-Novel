import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import type { IconType } from 'react-icons'
import {
  GiAnkh,
  GiBattleAxe,
  GiBrain,
  GiBreastplate,
  GiBroadsword,
  GiBrokenBone,
  GiBubblingFlask,
  GiCape,
  GiCrystalBall,
  GiCrystalWand,
  GiCutDiamond,
  GiDiamondRing,
  GiDramaMasks,
  GiEnvelope,
  GiGauntlet,
  GiGemPendant,
  GiHammerNails,
  GiHeartBeats,
  GiHearts,
  GiLaurelsTrophy,
  GiShield,
  GiSkullCrossedBones,
  GiHerbsBundle,
  GiKey,
  GiLeatherBoot,
  GiLockedChest,
  GiLyre,
  GiMeat,
  GiMuscleUp,
  GiOwl,
  GiPlainDagger,
  GiPocketBow,
  GiRoundShield,
  GiScrollUnfurled,
  GiSecretBook,
  GiSprint,
  GiStonePile,
  GiSwapBag,
  GiTreasureMap,
  GiTrident,
  GiTwoCoins,
  GiVisoredHelm,
  GiWarhammer,
  GiWizardStaff,
  GiCampfire,
} from 'react-icons/gi'
import { bondStage, MODEL3D_RARITIES, type Ability, type BondTrack, type Campaign, type IconKey, type InventoryItem, type Rarity, type Relation, type RelationAspect } from '@dnd/engine'
import { cn } from '../lib/util'
import { ArtActions, useArtUrl } from './art'

// Shared game visuals: the item icon catalog, rarity colours and ability names.

export const ITEM_ICONS: Record<IconKey, IconType> = {
  sword: GiBroadsword,
  dagger: GiPlainDagger,
  axe: GiBattleAxe,
  hammer: GiWarhammer,
  spear: GiTrident,
  bow: GiPocketBow,
  staff: GiWizardStaff,
  wand: GiCrystalWand,
  shield: GiRoundShield,
  armor: GiBreastplate,
  helmet: GiVisoredHelm,
  boots: GiLeatherBoot,
  gloves: GiGauntlet,
  cloak: GiCape,
  ring: GiDiamondRing,
  amulet: GiGemPendant,
  potion: GiBubblingFlask,
  scroll: GiScrollUnfurled,
  book: GiSecretBook,
  key: GiKey,
  gem: GiCutDiamond,
  coin: GiTwoCoins,
  orb: GiCrystalBall,
  herb: GiHerbsBundle,
  food: GiMeat,
  ore: GiStonePile,
  bone: GiBrokenBone,
  map: GiTreasureMap,
  letter: GiEnvelope,
  chest: GiLockedChest,
  tool: GiHammerNails,
  instrument: GiLyre,
  relic: GiAnkh,
  misc: GiSwapBag,
}

export const RARITY_STYLE: Record<Rarity, { label: string; text: string; tile: string; glow: string }> = {
  common: { label: 'Common', text: 'text-slate-500', tile: 'from-slate-300 to-slate-500', glow: 'shadow-slate-300/60' },
  uncommon: { label: 'Uncommon', text: 'text-emerald-600', tile: 'from-emerald-300 to-teal-500', glow: 'shadow-emerald-300/70' },
  rare: { label: 'Rare', text: 'text-sky-600', tile: 'from-sky-300 to-indigo-500', glow: 'shadow-sky-300/80' },
  epic: { label: 'Epic', text: 'text-violet-600', tile: 'from-violet-400 to-fuchsia-600', glow: 'shadow-fuchsia-300/80' },
  legendary: { label: 'Legendary', text: 'text-amber-600', tile: 'from-amber-300 to-orange-500', glow: 'shadow-amber-300/90' },
  mythic: { label: 'Mythic', text: 'text-rose-600', tile: 'from-rose-400 via-fuchsia-500 to-indigo-500', glow: 'shadow-rose-300/90' },
}

export const ABILITY_INFO: Record<Ability, { name: string; icon: IconType }> = {
  str: { name: 'Strength', icon: GiMuscleUp },
  dex: { name: 'Dexterity', icon: GiSprint },
  con: { name: 'Constitution', icon: GiHeartBeats },
  int: { name: 'Intelligence', icon: GiBrain },
  wis: { name: 'Wisdom', icon: GiOwl },
  cha: { name: 'Charisma', icon: GiDramaMasks },
}

const TILE_SIZES = { sm: 'size-7 rounded-lg text-base', md: 'size-10 rounded-xl text-xl', lg: 'size-14 rounded-2xl text-3xl' } as const

/** The item's generated icon when it has one (`art`), its catalog glyph otherwise. */
export function ItemIcon({ item, size = 'md' }: { item: Pick<InventoryItem, 'icon' | 'rarity'> & { art?: string }; size?: keyof typeof TILE_SIZES }) {
  const Icon = ITEM_ICONS[item.icon] ?? GiSwapBag
  const rarity = RARITY_STYLE[item.rarity]
  const url = useArtUrl(item.art)
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden bg-linear-to-br text-white shadow-md ring-2 ring-white/70', rarity.tile, rarity.glow, TILE_SIZES[size])}>
      {url && broken !== url ? <img src={url} alt="" data-testid="item-art" onError={() => setBroken(url)} className="size-full object-cover" /> : <Icon />}
    </span>
  )
}

const FRAME_EXTRA: Partial<Record<Rarity, string>> = { legendary: 'frame-legendary', mythic: 'frame-mythic' }
const ITEM_TILE_SIZES = { sm: 'size-12', md: 'size-16', lg: 'size-24' } as const
const ITEM_TILE_ICON = { sm: 'sm', md: 'md', lg: 'lg' } as const

interface ItemTileProps {
  item: Pick<InventoryItem, 'icon' | 'rarity' | 'name' | 'quantity' | 'equippedSlot'> & { art?: string }
  size?: keyof typeof ITEM_TILE_SIZES
  selected?: boolean
  onClick?: () => void
}

/** An item in its rarity frame, with the stack size and an equipped mark. */
export function ItemTile({ item, size = 'md', selected = false, onClick }: ItemTileProps) {
  const rarity = RARITY_STYLE[item.rarity]
  const body = (
    <>
      <span className="grid size-full place-items-center rounded-[13px] bg-linear-to-br from-white to-indigo-50/80">
        <ItemIcon item={item} size={ITEM_TILE_ICON[size]} />
      </span>
      {item.quantity > 1 && (
        <span className="absolute -right-1 -bottom-1 rounded-full bg-white px-1.5 text-[11px] font-black text-ink shadow ring-1 ring-indigo-100">×{item.quantity}</span>
      )}
      {item.equippedSlot && (
        <span title="Equipped" className="absolute -top-1.5 -left-1.5 grid size-5 place-items-center rounded-full bg-linear-to-br from-[#fff3c4] to-gilt-deep text-[11px] text-white shadow">
          <GiRoundShield />
        </span>
      )}
    </>
  )
  const className = cn(
    'relative grid shrink-0 rounded-2xl bg-linear-to-br p-[3px] shadow-md transition-shadow',
    rarity.tile,
    rarity.glow,
    FRAME_EXTRA[item.rarity],
    ITEM_TILE_SIZES[size],
    selected && 'ring-4 ring-violet-300 ring-offset-2',
  )
  if (!onClick) return <span className={className}>{body}</span>
  return (
    <motion.button type="button" aria-label={item.name} aria-pressed={selected} whileHover={{ y: -3, scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onClick} className={cn(className, 'cursor-pointer')}>
      {body}
    </motion.button>
  )
}

export const currencyName = (campaign: Campaign, id: string): string => campaign.world.currencies.find((c) => c.id === id)?.name ?? id

/** The full item template, for hover cards and the inventory list. */
export function ItemDetails({ item, campaign, actions = false }: { item: InventoryItem; campaign: Campaign; /** Show the art buttons (not in hover cards). */ actions?: boolean }) {
  const rarity = RARITY_STYLE[item.rarity]
  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-center gap-3">
        <ItemIcon item={item} size="lg" />
        <div className="min-w-0">
          <p className="font-extrabold text-ink">{item.name}</p>
          <p className={cn('text-xs font-extrabold tracking-wide uppercase', rarity.text)}>
            {rarity.label} · {item.type}
            {item.quantity > 1 && <span className="text-indigo-400"> · ×{item.quantity}</span>}
          </p>
        </div>
      </div>
      <p className="text-sm text-indigo-900/80">{item.description}</p>
      {item.stats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.stats.map((stat) => (
            <span key={stat.name} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
              {stat.name} {stat.value >= 0 ? `+${stat.value}` : stat.value}
            </span>
          ))}
        </div>
      )}
      {item.effects.length > 0 && (
        <ul className="list-inside list-disc text-xs text-violet-700">
          {item.effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      )}
      <p className="flex items-center gap-1 text-xs font-bold text-amber-600">
        <GiTwoCoins /> Worth {item.value.amount} {currencyName(campaign, item.value.currencyId)}
        {item.source && <span className="ml-auto truncate font-semibold text-indigo-400">{item.source}</span>}
      </p>
      {actions && <ArtActions target={{ kind: 'item', id: item.id }} image={item.art} can3d={MODEL3D_RARITIES.includes(item.rarity)} model3d={item.model3d} name={item.name} />}
    </div>
  )
}

/** A small card that appears above its trigger on hover or keyboard focus. */
interface HoverCardProps {
  children: ReactNode
  card: ReactNode
  className?: string
  /** Open below instead of above (for things at the top of a clipped panel). */
  side?: 'top' | 'bottom'
}

export function HoverCard({ children, card, className, side = 'top' }: HoverCardProps) {
  return (
    <span tabIndex={0} className={cn('group/hover relative inline-flex outline-none', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none invisible absolute left-1/2 z-30 w-72 -translate-x-1/2 rounded-2xl bg-white/97 p-3 opacity-0 shadow-xl shadow-indigo-200/70 ring-1 ring-indigo-100 transition-all duration-150 group-hover/hover:visible group-hover/hover:translate-y-0 group-hover/hover:opacity-100 group-focus/hover:visible group-focus/hover:translate-y-0 group-focus/hover:opacity-100',
          side === 'top' ? 'bottom-full mb-2 translate-y-1' : 'top-full mt-2 -translate-y-1',
        )}
      >
        {card}
      </span>
    </span>
  )
}

export const ASPECTS: { key: RelationAspect; label: string; icon: ReactNode; bar: string; text: string }[] = [
  { key: 'affinity', label: 'Affinity', icon: <GiHearts />, bar: 'from-pink-400 to-rose-500', text: 'text-pink-500' },
  { key: 'trust', label: 'Trust', icon: <GiShield />, bar: 'from-sky-400 to-indigo-500', text: 'text-sky-500' },
  { key: 'respect', label: 'Respect', icon: <GiLaurelsTrophy />, bar: 'from-amber-300 to-orange-500', text: 'text-amber-500' },
  { key: 'fear', label: 'Fear', icon: <GiSkullCrossedBones />, bar: 'from-slate-400 to-slate-600', text: 'text-slate-500' },
  { key: 'romance', label: 'Romance', icon: <GiHeartBeats />, bar: 'from-fuchsia-400 to-pink-500', text: 'text-fuchsia-500' },
]

/** A −100…100 bar that grows left or right from the middle. */
export function AspectBar({ value, bar }: { value: number; bar: string }) {
  return (
    <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-indigo-50">
      <span className="absolute inset-y-0 left-1/2 w-px bg-indigo-200" />
      <motion.span
        className={cn('absolute inset-y-0 w-1/2 bg-linear-to-r', bar, value >= 0 ? 'left-1/2 origin-left rounded-r-full' : 'right-1/2 origin-right rounded-l-full')}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.min(100, Math.abs(value)) / 100 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
      />
    </div>
  )
}

/** The aspect bars with their values; romance only once there is some. */
export function AspectBars({ relation }: { relation: Relation }) {
  return (
    <div className="flex flex-col gap-1.5">
      {ASPECTS.filter((a) => a.key !== 'romance' || relation.romance !== 0).map((aspect) => (
        <div key={aspect.key} className="flex items-center gap-2 text-xs font-bold">
          <span className={cn('text-base', aspect.text)}>{aspect.icon}</span>
          <span className="w-16 text-indigo-600">{aspect.label}</span>
          <AspectBar value={relation[aspect.key]} bar={aspect.bar} />
          <span className="w-8 text-right font-black text-ink">{relation[aspect.key]}</span>
        </div>
      ))}
    </div>
  )
}

export const TRACK_STYLE: Record<BondTrack, string> = {
  friendly: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  romance: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  hostile: 'bg-rose-50 text-rose-700 ring-rose-200',
}

/** The bond stage of a relationship as a small pill, with how they act at that stage on hover. */
export function BondBadge({ relation }: { relation: Relation | undefined }) {
  const stage = bondStage(relation)
  return (
    <span data-testid="bond-stage" title={stage.hint} className={cn('rounded-full px-2 py-0.5 text-[11px] font-extrabold ring-1', TRACK_STYLE[stage.track])}>
      {stage.track === 'romance' && <GiHeartBeats className="mr-0.5 inline size-3" />}
      {stage.name}
    </span>
  )
}

export function CompanionBadge() {
  return (
    <span data-testid="companion-badge" className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-extrabold text-amber-700 ring-1 ring-amber-200">
      <GiCampfire className="size-3" /> Companion
    </span>
  )
}

export function formatMinutes(minutes: number): string {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  return [days && `${days} d`, hours && `${hours} h`, mins && `${mins} min`].filter(Boolean).join(' ') || '0 min'
}
