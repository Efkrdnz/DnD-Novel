import type { ReactNode } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { GiCampfire, GiCoins, GiMusicalNotes, GiSpeaker } from 'react-icons/gi'
import type { AudioSettings } from '../../../../shared/settings'
import { audio } from '../../lib/audio'
import { useSettings } from '../../lib/settings'
import { Button, Slider, Toggle } from '../../ui/controls'
import { Card, SectionTitle } from '../../ui/surfaces'
import { SettingRow } from './GameMasterTab'

// Settings → Sound: volumes for the music, the scene's ambience and effects, mute, and quiet in the background.

const percent = (v: number) => `${Math.round(v * 100)}%`

export function SoundTab() {
  const { view, update } = useSettings()
  if (!view) return null
  const { audio: sound } = view.settings
  const set = (patch: Partial<AudioSettings>) => update((s) => ({ ...s, audio: { ...s.audio, ...patch } }))

  const volume = (key: 'master' | 'music' | 'ambience' | 'sfx', icon: ReactNode, title: string, hint: string) => (
    <SettingRow icon={icon} title={title} hint={hint}>
      <Slider label={title} min={0} max={1} step={0.05} value={sound[key]} onChange={(value) => set({ [key]: value })} format={percent} />
    </SettingRow>
  )

  return (
    <Card>
      <SectionTitle icon={<GiSpeaker />} tone="sky" title="Sound" subtitle="Music and the sound of each place follow the story. Ctrl+M mutes everything." />
      <div className="flex flex-col gap-5">
        <SettingRow icon={sound.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />} title="Mute" hint="Silence everything.">
          <Toggle label="Mute" checked={sound.muted} onChange={(muted) => set({ muted })} />
        </SettingRow>
        {volume('master', <Volume2 className="size-5" />, 'Overall', 'Everything at once.')}
        {volume('music', <GiMusicalNotes className="size-5" />, 'Music', 'Calm in town, wandering on the road, drums in a fight.')}
        {volume('ambience', <GiCampfire className="size-5" />, 'Places', 'Tavern murmur, wind and birds, waves, dripping caves, night crickets.')}
        {volume('sfx', <GiCoins className="size-5" />, 'Effects', 'Dice, coins, loot, hits and misses, quests.')}
        <SettingRow icon={<VolumeX className="size-5" />} title="Quiet in the background" hint="Mute while another window is in front.">
          <Toggle label="Quiet in the background" checked={sound.muteInBackground} onChange={(muteInBackground) => set({ muteInBackground })} />
        </SettingRow>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => audio.play('coins')}>
            Try: coins
          </Button>
          <Button size="sm" variant="secondary" onClick={() => audio.play('legendary')}>
            Try: legendary loot
          </Button>
          <Button size="sm" variant="secondary" onClick={() => audio.play('dice-land')}>
            Try: dice
          </Button>
        </div>
        <p className="text-xs font-semibold text-indigo-700/60">Effects and some places are free CC0 recordings (Kenney, OpenGameArt); the other places and the music are made by the game itself.</p>
      </div>
    </Card>
  )
}
