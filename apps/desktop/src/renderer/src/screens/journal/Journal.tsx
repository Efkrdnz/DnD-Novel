import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { GiBookCover, GiScrollUnfurled, GiThreeFriends, GiWorld } from 'react-icons/gi'
import type { Campaign } from '@dnd/engine'
import type { Journal as JournalData } from '../../../../shared/ipc'
import { errorMessage } from '../../lib/util'
import { Button, Segmented } from '../../ui/controls'
import { Codex } from './Codex'
import { LoreBook } from './LoreBook'
import { People } from './People'
import { QuestBook } from './QuestBook'

/** The inventory has its own screen since Phase 4. */
export type JournalTab = 'lore' | 'codex' | 'quests' | 'people'

const TABS: { value: JournalTab; label: string; icon: ReactNode }[] = [
  { value: 'lore', label: 'Lore Book', icon: <GiBookCover /> },
  { value: 'codex', label: 'Codex', icon: <GiWorld /> },
  { value: 'quests', label: 'Quests', icon: <GiScrollUnfurled /> },
  { value: 'people', label: 'People', icon: <GiThreeFriends /> },
]

const EMPTY: JournalData = { lore: [], conversations: [], relationshipHistory: [] }

interface Props {
  campaign: Campaign
  tab: JournalTab
  onTab: (tab: JournalTab) => void
  onChange: (campaign: Campaign) => void
  onBack: () => void
  onOpenMap: (placeId: string) => void
}

export function Journal({ campaign, tab, onTab, onChange, onBack, onOpenMap }: Props) {
  const [journal, setJournal] = useState<JournalData | null>(null)

  // Reload whenever the campaign changes (a turn, an era edit, a new Scribe summary).
  useEffect(() => {
    let alive = true
    window.game.getJournal(campaign.id).then(
      (data) => alive && setJournal(data),
      (err) => {
        if (!alive) return
        setJournal(EMPTY)
        toast.error('The journal could not be loaded', { description: errorMessage(err) })
      },
    )
    return () => {
      alive = false
    }
  }, [campaign.id, campaign.updatedAt, campaign.eras])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-6">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">{campaign.name}</p>
          <h1 className="title-shimmer font-display text-4xl font-bold">Journal</h1>
        </div>
        <Button variant="secondary" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Back to the adventure
        </Button>
      </div>

      <Segmented layoutId="journal-tab" size="lg" options={TABS} value={tab} onChange={onTab} />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          {journal === null ? null : tab === 'lore' ? (
            <LoreBook campaign={campaign} lore={journal.lore} onChange={onChange} />
          ) : tab === 'codex' ? (
            <Codex campaign={campaign} />
          ) : tab === 'quests' ? (
            <QuestBook campaign={campaign} onOpenMap={onOpenMap} />
          ) : (
            <People campaign={campaign} journal={journal} onChange={onChange} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
