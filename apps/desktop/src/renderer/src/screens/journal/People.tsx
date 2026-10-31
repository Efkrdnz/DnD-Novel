import { motion } from 'motion/react'
import { GiChatBubble, GiFlyingFlag, GiThreeFriends } from 'react-icons/gi'
import { factionStandings, type Campaign, type Character, type FactionStanding, type Relation } from '@dnd/engine'
import type { Journal } from '../../../../shared/ipc'
import { cn } from '../../lib/util'
import { AspectBar, AspectBars, BondBadge, CompanionBadge } from '../../ui/game'
import { Portrait } from '../../ui/portrait'
import { ArtActions, FacesPanel, OwnPictureButton } from '../../ui/art'
import { Card, EmptyState } from '../../ui/surfaces'
import { EditPersonButton } from './EditPerson'
import { ExpressionsCard } from './Expressions'

const RECENT = 5

/** Your standing with the factions you know: a bar from Hated to Revered. */
function Standing({ standings }: { standings: FactionStanding[] }) {
  return (
    <section data-testid="standing" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-[11px] font-extrabold tracking-widest text-indigo-400 uppercase">
        <GiFlyingFlag className="size-4" /> Standing
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {standings.map(({ faction, value, tier }) => (
          <div key={faction.id} data-faction={faction.id} className="flex flex-col gap-1.5 rounded-2xl bg-white/85 px-4 py-3 shadow-sm ring-1 ring-white">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-display font-bold text-indigo-950">{faction.name}</span>
              <span className={cn('text-xs font-extrabold', value >= 10 ? 'text-emerald-600' : value <= -10 ? 'text-rose-500' : 'text-indigo-500')}>
                {tier} {value > 0 ? `+${value}` : value}
              </span>
            </span>
            <AspectBar value={value} bar={value >= 0 ? 'from-emerald-300 to-teal-500' : 'from-rose-400 to-rose-600'} />
          </div>
        ))}
      </div>
    </section>
  )
}

/** The hero's own card: who you are, editable like everyone else. */
function HeroCard({ campaign, onChange }: { campaign: Campaign; onChange: (campaign: Campaign) => void }) {
  const { player } = campaign
  return (
    <section data-testid="hero-card" className="flex flex-col gap-3 rounded-3xl bg-white/85 p-5 shadow-sm ring-1 ring-violet-200">
      <div className="flex items-center gap-3">
        <Portrait name={player.name} size="lg" art={player.portrait} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold text-indigo-950">{player.name}</h3>
          <p className="text-xs font-bold text-violet-500">{['You', player.pronouns].filter(Boolean).join(' · ')}</p>
        </div>
        <EditPersonButton campaign={campaign} target={{ kind: 'hero' }} onChange={onChange} />
      </div>
      {player.background && <p className="text-sm text-indigo-950/80">{player.background}</p>}
      {player.appearance && <p className="text-xs text-indigo-800/70">{player.appearance}</p>}
    </section>
  )
}

export function People({ campaign, journal, onChange }: { campaign: Campaign; journal: Journal; onChange: (campaign: Campaign) => void }) {
  const standings = factionStandings(campaign)
  // Companions first, then everyone else in the order they were met.
  const people = [...campaign.characters].sort((a, b) => Number(b.companion) - Number(a.companion))
  return (
    <div className="flex flex-col gap-5">
      <HeroCard campaign={campaign} onChange={onChange} />
      {campaign.presentation.style === 'novel' && <ExpressionsCard campaign={campaign} onChange={onChange} />}
      {standings.length > 0 && <Standing standings={standings} />}
      {people.length === 0 ? (
        <Card>
          <EmptyState icon={<GiThreeFriends />} title="No one met yet">
            The people you meet get a card here: how they feel about you, what happened between you, and what you talked about.
          </EmptyState>
        </Card>
      ) : (
        <PeopleGrid people={people} campaign={campaign} journal={journal} onChange={onChange} />
      )}
    </div>
  )
}

function PeopleGrid({ people, campaign, journal, onChange }: { people: Character[]; campaign: Campaign; journal: Journal; onChange: (campaign: Campaign) => void }) {
  return (
    <motion.div className="grid grid-cols-2 gap-4" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
      {people.map((character) => (
        <PersonCard
          key={character.id}
          character={character}
          relation={campaign.relations.find((r) => r.characterId === character.id)}
          campaign={campaign}
          journal={journal}
          onChange={onChange}
        />
      ))}
    </motion.div>
  )
}

interface PersonProps {
  character: Character
  relation?: Relation
  campaign: Campaign
  journal: Journal
  onChange: (campaign: Campaign) => void
}

function PersonCard({ character, relation, campaign, journal, onChange }: PersonProps) {
  const history = journal.relationshipHistory.filter((h) => h.characterId === character.id).slice(-RECENT).reverse()
  const talks = journal.conversations.filter((c) => c.characterId === character.id).slice(-RECENT).reverse()
  const place = campaign.world.locations.find((l) => l.id === character.locationId)?.name
  return (
    <motion.article
      data-testid="person-card"
      data-name={character.name}
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      className={cn('flex flex-col gap-3 rounded-3xl bg-white/85 p-5 shadow-sm ring-1', character.companion ? 'ring-amber-200' : 'ring-white')}
    >
      <div className="flex items-center gap-3">
        <Portrait name={character.name} size="lg" art={character.portrait} />
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold text-indigo-950">
            {character.name}
            <BondBadge relation={relation} />
            {character.companion && <CompanionBadge />}
          </h3>
          <p className="text-xs font-bold text-indigo-400">{[character.role, place && `at ${place}`, `met day ${character.firstMetDay}`].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {character.description && <p className="text-sm text-indigo-950/80">{character.description}</p>}
      {(character.appearance || character.personality) && (
        <p className="text-xs text-indigo-800/70">{[character.appearance, character.personality].filter(Boolean).join(' · ')}</p>
      )}
      <ArtActions target={{ kind: 'character', id: character.id }} image={character.portrait} can3d model3d={character.model3d} name={character.name} />
      <div className="flex flex-wrap gap-2">
        <EditPersonButton campaign={campaign} target={{ kind: 'character', id: character.id }} onChange={onChange} />
        <OwnPictureButton target={{ kind: 'character', id: character.id }} name={character.name} />
      </div>
      {campaign.presentation.style === 'novel' && <FacesPanel campaign={campaign} character={character} />}

      {relation && (
        <div className="flex flex-col gap-1.5 rounded-2xl bg-indigo-50/50 p-3">
          <AspectBars relation={relation} />
          {relation.summary && <p className="mt-1 text-sm text-indigo-950 italic">“{relation.summary}”</p>}
          {relation.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {relation.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-violet-600 ring-1 ring-violet-100">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-extrabold tracking-widest text-indigo-400 uppercase">Recent changes</p>
          <ul className="flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.createdAt + h.characterId} className="flex flex-wrap items-center gap-x-2 text-xs">
                <span className="font-bold text-indigo-400">Day {h.day}</span>
                {Object.entries(h.deltas).map(([key, delta = 0]) => (
                  <span key={key} className={cn('font-extrabold', delta > 0 ? 'text-emerald-600' : 'text-rose-500')}>
                    {key} {delta > 0 ? `+${delta}` : delta}
                  </span>
                ))}
                {h.note && <span className="text-indigo-800/80">{h.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {talks.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-extrabold tracking-widest text-indigo-400 uppercase">
            <GiChatBubble /> Conversations
          </p>
          <ul className="flex flex-col gap-1">
            {talks.map((talk) => (
              <li key={talk.id} className="text-xs text-indigo-950/80">
                <span className="font-bold text-indigo-400">Day {talk.day}</span> {talk.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.article>
  )
}
