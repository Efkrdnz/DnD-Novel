import type { WizardSection } from './worldWizard'

// The demo GM's World Wizard replies: a fixed sample world, "The Glass Marches", so the wizard can be tried and
// tested without a key. They go through the same parser as a real model's replies.

const SAMPLE: Record<WizardSection, unknown> = {
  overview: {
    name: 'The Glass Marches',
    summary: 'A frontier of glittering salt-glass deserts where a fallen star shattered the sky. Caravans follow singing dunes between oasis-cities, and the shards still fall on stormy nights.',
    tone: { label: 'Sun-bleached wonder', notes: 'Wide skies, strange beauty and frontier grit. Danger is real but the world rewards curiosity.' },
    currencies: [
      { name: 'Grain', baseValue: 1 },
      { name: 'Shard', baseValue: 10 },
      { name: 'Starcoin', baseValue: 100 },
    ],
    start: { name: 'The Lantern Caravanserai', description: 'A walled caravan stop where traders, pilgrims and shard-hunters wait out the glass storms.' },
  },
  places: {
    regions: [
      { name: 'Shimmer Dunes', kind: 'desert', summary: 'Endless glass dunes that hum in the wind.', description: 'Dunes of fused glass ring like bells at dusk. Caravans read the songs to find their way.' },
      { name: 'Oasis of Veils', kind: 'city', summary: 'A trading city hidden behind mirages.', description: 'Its streets shift with the mirage each morning. Merchants swear by its night markets.' },
      { name: 'The Starfall Crater', kind: 'ruin', summary: 'Where the star struck; the sky is thin here.', description: 'Shards the size of towers jut from the crater. Some of them still glow.' },
      { name: 'Copper Cliffs', kind: 'mountains', summary: 'Red cliffs riddled with miners and wind-temples.', description: 'Cliff-towns cling to the rock, linked by kite-lines and rope lifts.' },
    ],
    factions: [
      { name: 'The Dune Choir', region: 'Shimmer Dunes', attitude: 'friendly', summary: 'Caravan guides who sing the dunes.', description: 'They know every safe path and charge in stories rather than coin.' },
      { name: 'House Veilmark', region: 'Oasis of Veils', attitude: 'neutral', summary: 'The merchant family that owns the oasis wells.', description: 'Polite, rich and always three deals ahead.' },
      { name: 'The Shardbound', region: 'The Starfall Crater', attitude: 'hostile', summary: 'Zealots who fuse star-shards into their skin.', description: 'They believe the star will rise again if fed enough light.' },
    ],
    startRegion: 'Shimmer Dunes',
  },
  lore: {
    gods: [
      { name: 'Ysolde of the Mirage', domain: 'Illusion, travel, luck', summary: 'The trickster who hides oases from the unworthy.' },
      { name: 'The Fallen Star', domain: 'Light, change, ruin', summary: 'Worshipped by some, feared by all; its body lies in the crater.' },
    ],
    races: [
      { name: 'Sandborn', summary: 'Humans of the caravans, sun-dark and wind-wise.' },
      { name: 'Glassfolk', summary: 'Translucent people grown from star-touched glass.' },
      { name: 'Kestrel Kin', summary: 'Bird-folk who nest on the Copper Cliffs.' },
    ],
    history: [
      { title: 'The Green Age', when: 'A thousand years ago', summary: 'The Marches were grassland and river kingdoms.' },
      { title: 'The Starfall', when: 'Five hundred years ago', summary: 'A falling star burned the plains to glass in a single night.' },
      { title: 'The First Caravan', when: 'Four hundred years ago', summary: 'The Dune Choir learned to read the singing sands and opened the trade roads.' },
      { title: 'The Shard Rush', when: 'Ten years ago', summary: 'Glowing shards began to fall again, and fortune-seekers flooded in.' },
    ],
  },
  power: {
    powerSystem: {
      name: 'Shardsong',
      summary: "Star-shards hold light that a trained voice can release. Singers tune shards worn as jewellery and spend their Glow; overuse cracks the shard and the singer's mind.",
      sources: [
        { name: 'Radiance', ability: 'cha', description: 'Light and heat sung from the shard.' },
        { name: 'Mirage', ability: 'int', description: 'Illusions bent from light.' },
        { name: 'Resonance', ability: 'wis', description: "Hearing and healing through the shard's hum." },
      ],
      resource: { name: 'Glow', description: 'Light stored in your shard; sunlight refills it.' },
      ranks: [
        { name: 'Hummer', minLevel: 1, description: 'Can coax small lights and sounds.' },
        { name: 'Cantor', minLevel: 5, description: 'Sings full songs that bend the world.' },
      ],
      limits: ['Shardsong needs a shard worn against the skin.', 'Singing in total darkness is impossible.'],
      templates: [
        { name: 'Sunflare', description: 'A blinding burst of light.', kind: 'attack', ability: 'cha', dice: '1d10', cost: 1, source: 'Radiance', rank: 'Hummer' },
        { name: 'False Oasis', description: 'Paint a vivid illusion.', kind: 'utility', ability: 'int', dice: null, cost: 1, source: 'Mirage', rank: 'Hummer' },
        { name: 'Soothing Hum', description: 'A tone that knits wounds.', kind: 'heal', ability: 'wis', dice: '1d8', cost: 1, source: 'Resonance', rank: 'Hummer' },
      ],
    },
    rules: null,
  },
}

export const DEMO_WIZARD_REPLIES: Record<WizardSection, string> = {
  overview: JSON.stringify(SAMPLE.overview),
  places: JSON.stringify(SAMPLE.places),
  lore: JSON.stringify(SAMPLE.lore),
  power: JSON.stringify(SAMPLE.power),
}
