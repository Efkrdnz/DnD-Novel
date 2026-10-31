# World packs (`.dndworld`)

A world pack is one JSON file that holds a whole setting:
- the world and its lore,
- its power system,
- its story direction,
- optional preset heroes.

The player can import it on Home ("Import world…"). Then they can start a campaign in it, play one of its heroes (and edit it) or create their own.

Exporting:
- **From Home:** any world card's Export button.
- **From a campaign:** Journal → Codex → "Export this world…". Turn on "Include my hero as a preset" to add the current hero and their starting companions.

The format is defined in `packages/engine/src/worldPack.ts` (`WorldPackSchema`). The world part is `WorldDraftSchema` in `packages/engine/src/world.ts`, which is the same shape the World Wizard produces.

## Rules the app enforces

- `format` must be `"dnd-world-pack"` and `version` must be `1`. Unknown keys are dropped.
- Size and file type: at most 2 MB, as a `.dndworld` (or `.json`) file.
- Imported packs are copied to `<userData>/worlds/<id>.dndworld`. If the id is already taken (by a built-in or an earlier import), the copy gets `<id>-2` and both are kept.
- The world:
  - It needs at least one region and one currency worth `1`.
  - Region, faction, god and race ids must all be different.
  - `start.regionId` and each faction's `regionId` must be one of the regions.
- Heroes:
  - At most 12, each with up to 2 companions.
  - `archetype` must name one of the world's `archetypes`. It is only used in DnD mode; `null` = the player picks in setup.
  - `attributes` are point-buy scores: 8–15 each, at most 27 points.
- Ranges:
  - `story.route` is `classic`, `romance`, `revenge`, `horror`, `chill`, `harem`, `mystery` or `custom`. For `custom`, the story is described in `story.custom`.
  - `story.intensity` is `gentle`, `standard` or `mature`.
  - A companion's `bond` is `childhood-friend`, `rival`, `mentor`, `sibling`, `love-interest` or `sworn-protector`.
- Errors are shown in readable form, for example `Hero 'Kael': archetype 'Spellblade' is not in this world.`

## How it plays

- **`world.premise` is the story direction:** the main conflict or hook. The GM gets it in its prompt as "Story direction: …" and steers toward it. Players never see it in the app, so it can hold secrets.
- **Story defaults:** picking a pack on Home preselects its route and intensity, which the player can still change.
- **Preset heroes:**
  - Choosing one fills in name, pronouns, background, appearance and power source, plus their companions.
  - All of it stays editable. Companions can also be edited, swapped for GM suggestions, or written from scratch.
  - In DnD mode, the hero's archetype and scores are preselected on the hero sheet step.
- **Campaigns copy the world** when they start. Removing or changing a pack later doesn't touch existing campaigns.

## Example

JSON has no comments, so the notes are in the list after the example. This example is checked by the content tests, so it stays valid.

```json
{
  "format": "dnd-world-pack",
  "version": 1,
  "meta": { "author": "Your name", "notes": "A short note for whoever imports this." },
  "world": {
    "id": "glass-isles",
    "name": "Glass Isles",
    "summary": "A chain of glass islands where the sea keeps secrets.",
    "premise": "The lighthouse keepers are vanishing one by one. The tide is taking them back to the drowned city they came from.",
    "tone": { "label": "Eerie", "notes": "Quiet dread, salt and lamplight. Rarely gory." },
    "currencies": [
      { "id": "shell", "name": "Shell", "baseValue": 1 },
      { "id": "pearl", "name": "Pearl", "baseValue": 50 }
    ],
    "regions": [
      { "id": "lantern-reef", "name": "Lantern Reef", "summary": "Lighthouses on every rock." },
      { "id": "still-water", "name": "Still Water", "summary": "A sea without waves." }
    ],
    "factions": [{ "id": "keepers", "name": "The Keepers", "regionId": "lantern-reef", "summary": "Tend the lights." }],
    "gods": [{ "id": "tide-mother", "name": "The Tide Mother", "summary": "Gives and takes back." }],
    "races": [{ "id": "saltborn", "name": "Saltborn", "summary": "Born with sea-grey eyes." }],
    "history": [{ "id": "drowning", "title": "The Drowning of Vael", "when": "200 years ago" }],
    "powerSystem": {
      "name": "Tidecraft",
      "summary": "Magic drawn from the pull of the moon on water.",
      "sources": [{ "id": "moon", "name": "Moonpull", "ability": "wis", "description": "Bend water and memory." }],
      "resource": { "name": "Tide" },
      "ranks": [{ "name": "Ripple", "minLevel": 1 }, { "name": "Undertow", "minLevel": 5 }]
    },
    "rules": null,
    "archetypes": [],
    "start": { "name": "Keeper's Rest", "description": "An inn at the foot of the tallest lighthouse.", "regionId": "lantern-reef" }
  },
  "story": { "route": "mystery", "custom": "", "intensity": "standard" },
  "presentation": { "style": "novel", "themeFaces": [] },
  "heroes": [
    {
      "id": "kael",
      "identity": {
        "name": "Kael",
        "pronouns": "he/him",
        "background": "A keeper's son who saw his father walk into the sea.",
        "appearance": "Salt-white hair, a lamp-burn on one hand.",
        "powerSource": "moon"
      },
      "archetype": null,
      "attributes": null,
      "companions": [
        { "name": "Vex", "role": "Smuggler", "description": "Knows every cove.", "appearance": "Gold teeth.", "personality": "Sly, loyal.", "bond": "rival" }
      ]
    }
  ]
}
```

Notes:
- `premise`: up to 1200 characters. Write it for the GM, not the player.
- `tone.label`: shown as a tag on the world card.
- `currencies`: up to 5. The GM prices things in any coin, and the app makes change.
- `presentation`: optional. `style` is `'classic'` (default) or `'novel'` (visual novel mode). `themeFaces` are optional story-specific emotions (up to 4: `'flustered'`, `'terrified'`, `'furious'`, `'disgusted'`, `'suspicious'`, `'determined'`).
- `portrait`: optional data URL for a preset hero's base portrait (png/jpeg/webp, ≤1.5 MB decoded). Companions in the hero's pack can also have portraits. Format: `"data:image/png;base64,..."`.
- `powerSystem`, `rules` and `archetypes`:
  - `powerSystem` is optional (`null` = no magic system).
  - `rules: null` uses the classic six abilities and skills. A pack can rename the abilities and replace the skills; see `RulesetSchema` in `packages/engine/src/ruleset.ts`.
  - `archetypes` are the DnD-mode hero options (`ArchetypeSchema` in `packages/engine/src/schemas.ts`). Without them the GM writes options for the world.
- `powerSource`: a power source id or name from `powerSystem.sources`.
- `archetype`: put an archetype `name` here in DnD packs. `attributes` are then e.g. `{ "str": 15, "dex": 14, "con": 13, "int": 10, "wis": 10, "cha": 8 }`.

## Adding a built-in preset

1. Add `packages/content/src/packs/<name>.ts` that exports a `WorldPackInput` (see `aurelion.ts`).
2. Add it to the `PRESET_PACKS` list in `packages/content/src/index.ts`.
3. Optional: give it a banner in `BANNERS` in `apps/desktop/src/renderer/src/screens/newgame/WorldPicker.tsx`.
4. Run `pnpm test`. The content tests validate every built-in pack, so a broken preset fails there instead of in a player's new game.
