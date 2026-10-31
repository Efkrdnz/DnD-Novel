import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { GiFootprint, GiPositionMarker, GiTreasureMap } from 'react-icons/gi'
import { describeTrip, positionOf, type Campaign, type Location, type Point, type Quest } from '@dnd/engine'
import { ArtActions, ArtImage } from '../../ui/art'
import { Button, spring } from '../../ui/controls'
import { Card, EmptyState } from '../../ui/surfaces'

// The world map: a drawn parchment with every place the player knows. Rumoured places wait under fog;
// quest destinations carry a gold marker; Travel here sends the journey to the GM as a turn.

interface Props {
  campaign: Campaign
  /** A place to select when the map opens (a quest's destination). */
  focusId: string | null
  onBack: () => void
  onTravel: (placeName: string) => void
}

interface Pin {
  place: Location
  at: Point
  quests: Quest[]
}

const REGION_TINTS = ['#f59e0b', '#8b5cf6', '#10b981', '#ec4899', '#0ea5e9', '#ef4444', '#84cc16', '#6366f1']
/** The map never zooms in closer than this many units across, so a single village is not a giant pin. */
const MIN_SPAN = 160
/** Room around the outermost pins (for labels and region names), as a share of the span, at least MIN_PAD units. */
const PAD = 0.2
const MIN_PAD = 34
/** Roughly the shape of the map card, so the parchment fills it. */
const ASPECT = 1.55

function viewOf(pins: Pin[]): { x: number; y: number; w: number; h: number; u: number } {
  const xs = pins.map((p) => p.at.x)
  const ys = pins.map((p) => p.at.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const pad = Math.max(MIN_PAD, PAD * Math.max(maxX - minX, maxY - minY))
  let w = Math.max(MIN_SPAN, maxX - minX + 2 * pad)
  let h = Math.max(MIN_SPAN / ASPECT, maxY - minY + 2 * pad)
  if (w / h < ASPECT) w = h * ASPECT
  else h = w / ASPECT
  return { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h, u: Math.min(w, h * ASPECT) / 100 }
}

function Compass({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={0.55} aria-hidden>
      <circle r={size} fill="none" stroke="#9a6b2f" strokeWidth={size / 18} />
      <path d={`M0 ${-size * 0.95} L${size * 0.18} 0 L0 ${size * 0.95} L${-size * 0.18} 0 Z`} fill="#9a6b2f" />
      <path d={`M${-size * 0.95} 0 L0 ${size * 0.18} L${size * 0.95} 0 L0 ${-size * 0.18} Z`} fill="#c79a5b" />
      <text y={-size * 1.15} textAnchor="middle" fontSize={size * 0.5} fontWeight={800} fill="#7c4f1d">
        N
      </text>
    </g>
  )
}

function MapCanvas({ campaign, pins, selected, onSelect }: { campaign: Campaign; pins: Pin[]; selected: Pin | null; onSelect: (id: string) => void }) {
  const view = viewOf(pins)
  const { u } = view
  const here = pins.find((p) => p.place.id === campaign.player.locationId)
  const regions = campaign.world.regions
    .map((region, i) => ({ region, tint: REGION_TINTS[i % REGION_TINTS.length]!, pins: pins.filter((p) => p.place.regionId === region.id) }))
    .filter((r) => r.pins.length > 0)

  return (
    <svg data-testid="world-map" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-full w-full rounded-[22px]" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="parchment" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#fdf3dc" />
          <stop offset="70%" stopColor="#f3dfb4" />
          <stop offset="100%" stopColor="#d9b77d" />
        </radialGradient>
        <filter id="paper" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0 0.12  0 0 0 0.16 0" result="grain" />
          <feComposite in="grain" in2="SourceGraphic" operator="in" />
          <feBlend in="SourceGraphic" mode="multiply" />
        </filter>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={u * 3} />
        </filter>
        <mask id="fog-mask">
          <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="white" />
          {pins
            .filter((p) => p.place.visited)
            .map((p) => (
              <circle key={p.place.id} cx={p.at.x} cy={p.at.y} r={u * 11} fill="black" filter="url(#soft)" />
            ))}
        </mask>
      </defs>

      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#parchment)" filter="url(#paper)" />
      <rect
        x={view.x + u * 1.5}
        y={view.y + u * 1.5}
        width={view.w - u * 3}
        height={view.h - u * 3}
        fill="none"
        stroke="#a87b3f"
        strokeWidth={u * 0.4}
        strokeDasharray={`${u * 2} ${u}`}
        opacity={0.5}
        rx={u * 2}
      />

      {regions.map(({ region, tint, pins: inRegion }) => {
        const cx = inRegion.reduce((sum, p) => sum + p.at.x, 0) / inRegion.length
        const top = Math.min(...inRegion.map((p) => p.at.y))
        return (
          <g key={region.id} data-region={region.id}>
            {inRegion.map((p) => (
              <circle key={p.place.id} cx={p.at.x} cy={p.at.y} r={u * 12} fill={tint} opacity={0.22} filter="url(#soft)" />
            ))}
            <text x={cx} y={top - u * 9} textAnchor="middle" fontSize={u * 3} fontWeight={800} letterSpacing={u * 0.4} fill={tint} opacity={0.85}>
              {region.name.toLocaleUpperCase()}
            </text>
          </g>
        )
      })}

      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="#b9ad98" opacity={0.55} mask="url(#fog-mask)" />

      {here && selected && selected !== here && (
        <motion.line
          key={selected.place.id}
          x1={here.at.x}
          y1={here.at.y}
          x2={selected.at.x}
          y2={selected.at.y}
          stroke="#7c4f1d"
          strokeWidth={u * 0.6}
          strokeDasharray={`${u * 1.6} ${u * 1.2}`}
          strokeLinecap="round"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        />
      )}

      {pins.map((pin) => (
        <PlaceMarker key={pin.place.id} pin={pin} u={u} current={pin === here} selected={pin === selected} onSelect={() => onSelect(pin.place.id)} />
      ))}

      <Compass x={view.x + view.w - u * 9} y={view.y + u * 10} size={u * 5} />
    </svg>
  )
}

function PlaceMarker({ pin, u, current, selected, onSelect }: { pin: Pin; u: number; current: boolean; selected: boolean; onSelect: () => void }) {
  const { place, at, quests } = pin
  const rumoured = !place.visited
  return (
    <g
      data-testid="map-pin"
      data-place={place.name}
      data-state={current ? 'current' : rumoured ? 'rumoured' : 'visited'}
      data-quest={quests.length > 0}
      role="button"
      tabIndex={0}
      aria-label={place.name}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className="cursor-pointer outline-none"
      transform={`translate(${at.x} ${at.y})`}
    >
      {current && <motion.circle r={u * 3} fill="#f43f5e" initial={{ opacity: 0.5, scale: 1 }} animate={{ opacity: 0, scale: 2.4 }} transition={{ duration: 1.6, repeat: Infinity }} />}
      {selected && <circle r={u * 3.6} fill="none" stroke="#8b5cf6" strokeWidth={u * 0.6} />}
      <circle
        r={u * (current ? 2.4 : 2)}
        fill={current ? '#f43f5e' : rumoured ? '#cbb89a' : '#d4a24c'}
        stroke={rumoured ? '#8a7350' : '#7c4f1d'}
        strokeWidth={u * 0.45}
        strokeDasharray={rumoured ? `${u * 0.8} ${u * 0.5}` : undefined}
      />
      {rumoured && (
        <text y={u * 1} textAnchor="middle" fontSize={u * 2.6} fontWeight={900} fill="#6b5536">
          ?
        </text>
      )}
      {quests.length > 0 && (
        <g transform={`translate(${u * 2.2} ${-u * 2.6})`} data-testid="quest-marker">
          <motion.circle r={u * 1.7} fill="#f59e0b" stroke="#fff" strokeWidth={u * 0.35} animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
          <text y={u * 0.75} textAnchor="middle" fontSize={u * 2.2} fontWeight={900} fill="#fff">
            !
          </text>
        </g>
      )}
      <text
        y={u * 5.4}
        textAnchor="middle"
        fontSize={u * 2.5}
        fontWeight={800}
        fill={rumoured ? '#7a6649' : '#4a2e10'}
        stroke="#fbf1d9"
        strokeWidth={u * 0.7}
        paintOrder="stroke"
        fontStyle={rumoured ? 'italic' : undefined}
      >
        {place.name}
      </text>
    </g>
  )
}

function PlaceCard({ campaign, pin, onTravel }: { campaign: Campaign; pin: Pin; onTravel: () => void }) {
  const { place, quests } = pin
  const here = campaign.player.locationId === place.id
  const region = campaign.world.regions.find((r) => r.id === place.regionId)
  const trip = describeTrip(campaign.world, campaign.player.locationId, place.id)
  const people = campaign.characters.filter((c) => c.locationId === place.id)
  return (
    <motion.div key={place.id} data-testid="place-card" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={spring} className="flex flex-col gap-3">
      {place.art && <ArtImage assetId={place.art} target={{ kind: 'place', id: place.id }} alt={place.name} className="aspect-video w-full rounded-2xl shadow-md" fallback={null} />}
      <div>
        <p className="text-[11px] font-extrabold tracking-widest text-amber-600 uppercase">{region?.name ?? 'Unknown lands'}</p>
        <h3 className="font-display text-2xl font-bold text-indigo-950">{place.name}</h3>
        <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-extrabold">
          {here && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600 ring-1 ring-rose-200">You are here</span>}
          {!place.visited && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600 ring-1 ring-stone-200">Rumoured · not yet visited</span>}
          {place.visited && !here && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-amber-200">Visited · day {place.firstVisitedDay}</span>}
        </p>
      </div>
      {place.description && <p className="text-sm text-indigo-950/80">{place.description}</p>}
      {trip && (
        <p className="flex items-center gap-2 text-sm font-bold text-indigo-700" data-testid="trip">
          <GiFootprint className="text-lg text-amber-600" /> {trip} from here
        </p>
      )}
      {quests.length > 0 && (
        <div className="rounded-2xl bg-amber-50/80 p-3 ring-1 ring-amber-200">
          <p className="mb-1 text-[11px] font-extrabold tracking-widest text-amber-700 uppercase">Quests here</p>
          {quests.map((q) => (
            <p key={q.id} className="text-sm font-bold text-amber-900">
              ! {q.title}
            </p>
          ))}
        </div>
      )}
      {people.length > 0 && <p className="text-xs text-indigo-700/80">People there: {people.map((c) => c.name).join(', ')}</p>}
      <ArtActions target={{ kind: 'place', id: place.id }} image={place.art} name={place.name} />
      <Button icon={<GiFootprint className="size-5" />} disabled={here} onClick={onTravel}>
        {here ? 'You are here' : 'Travel here'}
      </Button>
    </motion.div>
  )
}

function Legend({ campaign }: { campaign: Campaign }) {
  const { world } = campaign
  const unexplored = world.regions.filter((r) => !world.locations.some((l) => l.regionId === r.id))
  return (
    <Card className="p-4!">
      <p className="mb-2 text-[11px] font-extrabold tracking-widest text-indigo-400 uppercase">Legend</p>
      <ul className="flex flex-col gap-1.5 text-xs font-bold text-indigo-800">
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-rose-500" /> You are here
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#d4a24c]" /> Visited
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full border border-dashed border-stone-500 bg-stone-300" /> Rumoured, under fog
        </li>
        <li className="flex items-center gap-2">
          <span className="grid size-3 place-items-center rounded-full bg-amber-500 text-[8px] text-white">!</span> Quest destination
        </li>
      </ul>
      {unexplored.length > 0 && (
        <div className="mt-3" data-testid="unexplored">
          <p className="mb-1 text-[11px] font-extrabold tracking-widest text-indigo-400 uppercase">Unexplored lands</p>
          <p className="text-xs text-indigo-700/80">{unexplored.map((r) => r.name).join(' · ')}</p>
        </div>
      )}
      <p className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-indigo-500/70">
        <GiPositionMarker /> Distances are travel time on foot; the GM narrates every journey.
      </p>
    </Card>
  )
}

export function WorldMap({ campaign, focusId, onBack, onTravel }: Props) {
  const { world, player } = campaign
  const pins = useMemo<Pin[]>(
    () =>
      world.locations.map((place) => ({
        place,
        at: positionOf(world, place),
        quests: campaign.quests.filter((q) => q.status === 'active' && q.locationId === place.id),
      })),
    [world, campaign.quests],
  )
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? player.locationId ?? pins[0]?.place.id ?? null)
  const selected = pins.find((p) => p.place.id === selectedId) ?? null

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-6 py-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">{campaign.name}</p>
          <h1 className="font-display text-4xl font-bold text-indigo-950">{world.name}</h1>
        </div>
        <Button variant="secondary" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Back to the adventure
        </Button>
      </header>

      {pins.length === 0 ? (
        <Card>
          <EmptyState icon={<GiTreasureMap />} title="Your map is still blank">
            The places you visit and hear of appear here as your story unfolds.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <Card className="relative min-h-0 flex-1 overflow-hidden p-2!">
            <MapCanvas campaign={campaign} pins={pins} selected={selected} onSelect={setSelectedId} />
          </Card>
          <aside className="scroll-fancy flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
            <Card className="p-5!">
              {selected ? <PlaceCard campaign={campaign} pin={selected} onTravel={() => onTravel(selected.place.name)} /> : <p className="text-sm text-indigo-700/70">Pick a place on the map.</p>}
            </Card>
            <Legend campaign={campaign} />
          </aside>
        </div>
      )}
    </div>
  )
}
