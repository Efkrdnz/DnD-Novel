import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Settings2 } from 'lucide-react'
import { GiBookCover, GiCastle, GiCrossedSwords, GiDiceTwentyFacesTwenty, GiKnapsack, GiTreasureMap, GiVisoredHelm } from 'react-icons/gi'
import { cn } from '../lib/util'
import { spring } from '../ui/controls'

export type Route = 'home' | 'adventure' | 'map' | 'hero' | 'inventory' | 'journal' | 'settings'

/** Routes that need an open campaign. */
const NEEDS_CAMPAIGN: Route[] = ['adventure', 'map', 'hero', 'inventory', 'journal']

const NAV: { route: Route; label: string; icon: ReactNode }[] = [
  { route: 'home', label: 'Home', icon: <GiCastle className="size-6" /> },
  { route: 'adventure', label: 'Adventure', icon: <GiCrossedSwords className="size-6" /> },
  { route: 'map', label: 'Map', icon: <GiTreasureMap className="size-6" /> },
  { route: 'hero', label: 'Hero', icon: <GiVisoredHelm className="size-6" /> },
  { route: 'inventory', label: 'Inventory', icon: <GiKnapsack className="size-6" /> },
  { route: 'journal', label: 'Journal', icon: <GiBookCover className="size-6" /> },
  { route: 'settings', label: 'Settings', icon: <Settings2 className="size-6" /> },
]

export function Shell({
  route,
  onNavigate,
  canAdventure,
  children,
}: {
  route: Route
  onNavigate: (route: Route) => void
  canAdventure: boolean
  children: ReactNode
}) {
  return (
    <div className="relative flex h-screen overflow-hidden">
      <SkyBackground />
      <nav aria-label="Main" className="glass relative z-10 m-3 mr-0 flex w-22 flex-col items-center gap-2 rounded-[28px] py-4">
        <motion.div
          whileHover={{ rotate: 360, scale: 1.08 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
          className="mb-3 grid size-12 place-items-center rounded-2xl bg-linear-to-br from-violet-500 to-pink-500 text-white shadow-lg shadow-fuchsia-300/60"
        >
          <GiDiceTwentyFacesTwenty className="size-7" />
        </motion.div>
        {NAV.map((item) => {
          const disabled = NEEDS_CAMPAIGN.includes(item.route) && !canAdventure
          const active = route === item.route
          return (
            <button
              key={item.route}
              type="button"
              disabled={disabled}
              onClick={() => onNavigate(item.route)}
              aria-current={active ? 'page' : undefined}
              title={disabled ? 'Start or continue an adventure first' : item.label}
              className={cn(
                'relative flex w-17 cursor-pointer flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-extrabold transition-colors',
                active ? 'text-violet-700' : 'text-indigo-700/60 hover:text-ink',
                disabled && 'cursor-not-allowed opacity-35',
              )}
            >
              {active && (
                <motion.span
                  layoutId="rail-active"
                  transition={spring}
                  className="absolute inset-0 rounded-2xl bg-white shadow-md shadow-indigo-200/70"
                />
              )}
              <motion.span className="relative" whileHover={disabled ? undefined : { scale: 1.18, rotate: -8 }} transition={spring}>
                {item.icon}
              </motion.span>
              <span className="relative">{item.label}</span>
            </button>
          )
        })}
      </nav>
      <main className="scroll-fancy relative z-10 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}

const CLOUDS = [
  { top: '6%', width: 380, duration: 110, delay: -30, opacity: 0.75 },
  { top: '22%', width: 260, duration: 85, delay: -70, opacity: 0.6 },
  { top: '48%', width: 460, duration: 140, delay: -10, opacity: 0.5 },
  { top: '72%', width: 320, duration: 100, delay: -55, opacity: 0.55 },
]

// Deterministic "random" spread so stars don't jump between renders.
const STARS = Array.from({ length: 22 }, (_, i) => ({
  left: `${(i * 47 + 11) % 100}%`,
  top: `${(i * 31 + 7) % 82}%`,
  delay: `${((i * 0.73) % 4).toFixed(2)}s`,
  size: 6 + (i % 3) * 3,
}))

function SkyBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{
        background:
          'radial-gradient(1200px 600px at 15% -10%, #fff6d8 0%, transparent 60%), radial-gradient(900px 500px at 110% 20%, #ffd6ec 0%, transparent 55%), linear-gradient(165deg, #b9ddff 0%, #dcd4ff 45%, #ffe1f0 75%, #ffeccc 100%)',
      }}
    >
      {CLOUDS.map((cloud, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white blur-2xl"
          style={{
            top: cloud.top,
            width: cloud.width,
            height: cloud.width * 0.32,
            opacity: cloud.opacity,
            animation: `drift ${cloud.duration}s linear ${cloud.delay}s infinite`,
          }}
        />
      ))}
      {STARS.map((star, i) => (
        <span
          key={i}
          className="animate-twinkle absolute rotate-45 rounded-[2px] bg-white shadow-[0_0_12px_4px_rgba(255,255,255,0.8)]"
          style={{ left: star.left, top: star.top, width: star.size, height: star.size, animationDelay: star.delay }}
        />
      ))}
    </div>
  )
}
