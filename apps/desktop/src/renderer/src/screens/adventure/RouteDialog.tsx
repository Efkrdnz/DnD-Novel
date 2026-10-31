import { useState } from 'react'
import { toast } from 'sonner'
import { GiCompass } from 'react-icons/gi'
import { ROUTES, type Campaign, type Intensity, type StoryRouteId } from '@dnd/engine'
import { errorMessage } from '../../lib/util'
import { Button, Textarea } from '../../ui/controls'
import { IntensityPicker, RouteIcon, RoutePicker } from '../../ui/routes'
import { Modal } from '../../ui/surfaces'

// Changing the story route and intensity mid-campaign. The next turns follow the new route.

export function RouteButton({ campaign, onClick }: { campaign: Campaign; onClick: () => void }) {
  const route = ROUTES[campaign.storyRoute.id]
  return (
    <button
      type="button"
      onClick={onClick}
      title="Change the kind of story"
      data-testid="route-button"
      className="flex cursor-pointer items-center gap-2 rounded-2xl bg-white/80 py-1 pr-3 pl-1 text-sm font-extrabold text-indigo-900 shadow-sm ring-1 ring-indigo-100 hover:ring-pink-300"
    >
      <RouteIcon id={route.id} className="size-7" />
      {route.name}
    </button>
  )
}

export function RouteDialog({ campaign, open, busy, onClose, onChange }: { campaign: Campaign; open: boolean; busy: boolean; onClose: () => void; onChange: (campaign: Campaign) => void }) {
  const [route, setRoute] = useState<StoryRouteId>(campaign.storyRoute.id)
  const [custom, setCustom] = useState(campaign.storyRoute.custom)
  const [intensity, setIntensity] = useState<Intensity>(campaign.intensity)
  const [saving, setSaving] = useState(false)
  const unchanged = route === campaign.storyRoute.id && intensity === campaign.intensity && (route !== 'custom' || custom === campaign.storyRoute.custom)

  const save = async () => {
    if (busy) return void toast.info('Wait until the Game Master has finished.')
    setSaving(true)
    try {
      onChange(await window.game.setRoute(campaign.id, { id: route, custom, intensity }))
      toast.success(`The story turns: ${ROUTES[route].name}`, { description: 'The Game Master will steer the next scenes this way.' })
      onClose()
    } catch (err) {
      toast.error('The route was not changed', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="What kind of story?" icon={<GiCompass />} wide>
      <div className="flex flex-col gap-4">
        <RoutePicker value={route} onChange={setRoute} />
        {route === 'custom' && (
          <Textarea value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={600} rows={3} placeholder="Describe your story…" aria-label="Custom story" />
        )}
        <IntensityPicker value={intensity} onChange={setIntensity} layoutId="route-intensity" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} disabled={unchanged || (route === 'custom' && !custom.trim())} onClick={() => void save()}>
            Change the story
          </Button>
        </div>
      </div>
    </Modal>
  )
}
