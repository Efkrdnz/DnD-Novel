import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Box, Dices, ImagePlus, Sparkles } from 'lucide-react'
import { GiCube, GiPaintBrush, GiPalette } from 'react-icons/gi'
import { ART_PRESETS, type ArtStyle, type Campaign } from '@dnd/engine'
import type { ArtSettings } from '../../../../shared/settings'
import { useSettings } from '../../lib/settings'
import { cn, errorMessage } from '../../lib/util'
import { Button, Input, Slider, spring, Toggle } from '../../ui/controls'
import { Card, SectionTitle } from '../../ui/surfaces'
import { ChainCard, SettingRow } from './GameMasterTab'

// Settings → Art: who draws (image and 3D chains), when (auto art and its cap), and, with a campaign open,
// its style lock: one look and one seed for every picture in that campaign.

const PRESET_LABELS: Record<ArtStyle['preset'], string> = {
  anime: 'Anime',
  painterly: 'Painterly',
  storybook: 'Storybook',
  ink: 'Ink & wash',
  custom: 'My own',
}

export function ArtTab({ campaign, onCampaign }: { campaign: Campaign | null; onCampaign?: (campaign: Campaign) => void }) {
  const { view, update } = useSettings()
  if (!view) return null
  const { art } = view.settings
  const setArt = (patch: Partial<ArtSettings>) => update((s) => ({ ...s, art: { ...s.art, ...patch } }))

  return (
    <div className="flex flex-col gap-5">
      <ChainCard
        route="image"
        use="image"
        icon={<ImagePlus />}
        tone="sakura"
        title="Pictures"
        subtitle="Portraits, item icons and places. Tried in order; if one fails, the next draws."
        emptyHint="No pictures until you add Gemini or Wavespeed here."
      />
      <ChainCard
        route="model3d"
        use="model3d"
        icon={<Box />}
        tone="mint"
        title="3D models"
        subtitle="Built on request from a picture, for characters and legendary or mythic items."
        emptyHint="Add Meshy here to turn pictures into 3D models."
      />

      <Card>
        <SectionTitle icon={<GiPaintBrush />} tone="sky" title="When to draw" subtitle="Art comes in the background; play never waits for it." />
        <div className="flex flex-col gap-5">
          <SettingRow icon={<Sparkles className="size-5" />} title="Draw at key moments" hint="Your hero, new people, rare or better items and new places.">
            <Toggle label="Draw at key moments" checked={art.auto} onChange={(auto) => setArt({ auto })} />
          </SettingRow>
          <SettingRow icon={<GiPalette className="size-5" />} title="Pictures per campaign" hint="The most it draws on its own. Your own Generate clicks do not count.">
            <Slider label="Pictures per campaign" min={0} max={300} step={10} value={art.autoCap} onChange={(autoCap) => setArt({ autoCap })} format={(v) => String(v)} />
          </SettingRow>
          <p className="text-xs font-semibold text-indigo-700/60">
            Cost guide: a Gemini or Wavespeed picture costs a few cents at most; a Meshy 3D model uses about 20–30 credits. Pictures are cached, so nothing is paid for twice.
          </p>
        </div>
      </Card>

      {campaign && <StyleLock campaign={campaign} onCampaign={onCampaign} />}
    </div>
  )
}

function StyleLock({ campaign, onCampaign }: { campaign: Campaign; onCampaign?: (campaign: Campaign) => void }) {
  const [style, setStyle] = useState(campaign.artStyle)
  const [custom, setCustom] = useState(campaign.artStyle.custom)
  useEffect(() => {
    setStyle(campaign.artStyle)
    setCustom(campaign.artStyle.custom)
  }, [campaign.id, campaign.artStyle])

  const save = async (patch: Partial<ArtStyle>) => {
    try {
      const updated = await window.game.setArtStyle(campaign.id, patch)
      setStyle(updated.artStyle)
      onCampaign?.(updated)
    } catch (err) {
      toast.error('Could not change the art style', { description: errorMessage(err) })
    }
  }

  return (
    <Card>
      <SectionTitle icon={<GiCube />} tone="sakura" title={`Style of “${campaign.name}”`} subtitle="Every picture in this campaign uses this look and seed, so they match. Pictures drawn before keep their style until you redraw them." />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Art style">
          {ART_PRESETS.map((preset) => {
            const active = style.preset === preset
            return (
              <motion.button
                key={preset}
                type="button"
                role="radio"
                aria-checked={active}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.95 }}
                transition={spring}
                onClick={() => void save({ preset })}
                className={cn(
                  'cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-bold shadow-sm ring-1 transition-colors',
                  active ? 'bg-linear-to-br from-violet-500 to-pink-500 text-white ring-transparent' : 'bg-white/90 text-violet-700 ring-violet-100 hover:ring-violet-300',
                )}
              >
                {PRESET_LABELS[preset]}
              </motion.button>
            )
          })}
        </div>
        {style.preset === 'custom' && (
          <Input
            value={custom}
            maxLength={300}
            placeholder="Describe the look: e.g. moody watercolour, muted greens, soft light"
            aria-label="Your own art style"
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => custom !== style.custom && void save({ custom })}
          />
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" variant="secondary" icon={<Dices className="size-4" />} onClick={() => void save({ seed: 1 + Math.floor(Math.random() * 2_000_000_000) })}>
            Re-roll seed
          </Button>
          <span className="text-xs font-semibold text-indigo-700/60" data-testid="art-seed">
            Seed {style.seed === 0 ? 'from the campaign' : style.seed}
          </span>
        </div>
      </div>
    </Card>
  )
}
