# AI Fantasy RPG ("DND TYPESHIT") — Master Implementation Plan

## Context
Greenfield project (`E:\DND TYPESHIT` is empty apart from Multimine files). The goal is a single-player desktop fantasy RPG with an AI game master. The player should feel like they live in a fantasy world, with lore, a power system, a map, NPC relationships, quests, an inventory with currencies, animated loot and dice, and anime-style speech bubbles. It has two game modes: **Story** (relaxed, the player decides what happens) and **DnD** (dice rolls, and the GM rules on the outcome). The AI layer is pluggable: your subscriptions, direct API keys, a fallback chain and local Ollama, plus image and 3D generation tools.

We build it **one phase at a time**. Each phase ends with something you can run, and we review it before starting the next.

**Decisions so far:** Electron desktop app (Windows first) · single-player · preset worlds plus an AI world wizard · painterly anime/JRPG look.

---

## Core architecture principle (most important decision)
**The engine owns the truth. The AI narrates and asks for changes.**
- Inventory, currency, HP, relationships, quests, time and dice all live in a typed game state stored in SQLite.
- The AI changes state only through **tool calls**, such as `grant_item`, `spend_currency`, `adjust_relation`, `request_check(skill, DC)`, `advance_time`, `start_quest` and `move_to`. The engine validates every call, applies it, and fires UI events (loot animation, dice roll, toast).
- The engine rolls the dice, not the AI. In DnD mode the GM calls `request_check`, the engine rolls with an animation, and the result goes back to the GM to narrate.
- This keeps saves consistent and lets every animation trigger reliably from a structured event, not from parsed prose.

## Tech stack
| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite. The main process does AI calls, keys, file and CLI access; the renderer is the UI. |
| UI | React + TypeScript, Tailwind, Motion (Framer) for animations, Zustand for UI state |
| Game data | SQLite (better-sqlite3) + Drizzle ORM, with one save file per campaign. Zod schemas shared by the engine, tools and UI. |
| AI | Vercel AI SDK (`ai`), with providers for Anthropic, OpenAI, Google Gemini, Groq, Ollama, OpenRouter and any OpenAI-compatible API, plus custom CLI-bridge adapters |
| Secrets | Electron `safeStorage` (Windows DPAPI) for API keys. Keys never reach the renderer. |
| Dice | `@3d-dice/dice-box` (3D physics dice), with a 2D fallback |
| Map | PixiJS or Konva canvas: an image map with pins, a fog of war and travel |
| Tests | Vitest for the engine (pure TypeScript, no AI needed), Playwright for Electron end-to-end |

## Repo layout (target)
```
apps/desktop/            Electron main + preload + renderer (React)
packages/engine/         pure TS game rules: state, tools, dice, time, validation (no I/O)
packages/ai/             provider adapters, fallback chain, prompt builder, context/memory
packages/content/        preset worlds, power systems, item catalogs, icon sets (JSON + assets)
packages/assets/         image/3D generation adapters (Wavespeed, Meshy, MCP client) + cache
```

---

## Design decisions (2026-10)
1. **Items: the AI invents, the app owns.** The AI fills a fixed item template (name, type, rarity, description, stats, effects, value, icon, stackable). The app validates it and stores it in the inventory. The AI never holds inventory or currency state.
2. **Memory and books are app-owned:**
   - **Lore Book:** important events are summarized in chronological order and grouped into eras (Civilization-style). It is also the GM's long-term memory: each turn gets the relevant era summaries and entries instead of the whole chat.
   - **Personal conversations:** important one-on-one talks are summarized and kept.
   - **Quest Book:** bounties, missions and quests, each with a summary and a status.
   - **Relationships:**
     - every aspect of the player's relationship with each character, owned by the app
     - the AI writes the entry when a character first appears and reads it to play them
     - after scenes, the AI proposes updates (e.g. trust +1, "holds a grudge about the bridge"), which the app validates and applies
3. **Dice belong to the app.** The app rolls (the player clicks Roll, or auto-roll if enabled), and the AI only receives the result.
4. **Gemini API is the main provider** because it's fast. Claude/ChatGPT subscriptions and the Claude API stay as options behind the same provider layer.
5. **Quality over speed.** Each phase is split into sub-steps, each reviewed before the next.

| Decision | Phases affected |
|---|---|
| 1 Item template | **2** (template, validation, storage) · **4** (grid and loot animations read the template) · **10** (generated icons replace catalog icons) |
| 2 Books & memory | **2** (data, recording, memory) · **6** (preset world lore becomes "Era 0") · **7** (more aspects, routes) · **8** (Quest Book drives map markers) · **9** shrinks to memory quality |
| 3 App dice | **2** (roller, check flow, 2D dice card) · **5** (3D dice, character sheet modifiers, combat) |
| 4 Gemini main | **2** (defaults, Recommended badge, Gemini-safe tool schemas) · **11** (CLIs get native tools via MCP) |
| 5 Quality first | every phase |

## Phases

### Phase 0: Foundations
- Monorepo (pnpm workspaces), Electron + React + TS scaffold, lint, Vitest, a main-to-renderer IPC bridge with typed channels.
- Zod schemas for the core state: `Campaign, World, Character, Npc, Item, Currency, Quest, Relation, Location, TimeOfDay`.
- SQLite save system: new, load and autosave a campaign.
- **Done when:** the app opens, creates an empty campaign, saves it, reloads it, and the tests pass.

### Phase 1: AI provider layer + settings
- `AiProvider` interface (streaming text + tool calls) with adapters for Anthropic, OpenAI, Gemini, Groq, Ollama, OpenRouter and generic OpenAI-compatible APIs.
- **Fallback chain**: an ordered list of providers. On an error or rate limit, the next one takes over automatically.
- Settings screen: keys (encrypted), model pick per role (GM, NPC voices, cheap summarizer), temperature, **custom GM instructions** (style, tone, language), and a connection test button.
- **Subscription bridges (moved up from Phase 11):** Claude Code (`claude -p`, streaming) and Codex (`codex exec --json`) adapters, run headless and tool-less. The conversation goes over stdin.
- The chat is saved in the campaign file (`messages` table), and the GM rereads the last N messages each turn.
- **Done when:** a plain chat with the GM streams from at least 2 providers, and the fallback works when you kill one. ✅ Done (both CLI bridges verified live).

### Phase 2: Game engine, GM commands, books & memory, dice
One command set (Zod schemas + pure engine handlers), sent two ways:
- native tool calling for HTTP providers (Gemini first)
- an `<<<ACTIONS>>>` text block for the CLI bridges

Each turn is a transaction: it rolls back on failure, and Retry reuses rolls already made.

- **2A Engine core:** schema v2 + migration, item template + icon catalog, inventory and wallet, clock, locations, characters + relationship aspects (affinity/trust/respect/fear, tags, notes), quests, eras, dice (notation, advantage, checks), input modes. The full command set is enforced by a `Turn` object. `[bracket]` turns are read-only.
- **2B GM turn loop:** native-tools runner + text-protocol runner, the check → Roll → continue flow, the `turns` table (Phase 1 messages migrated), prompt v2 with a state snapshot, Gemini-first defaults.
- **2C Books & memory:**
  - Lore Book entries and eras, conversation summaries, relationship history
  - a Scribe role that writes era summaries
  - memory assembled per turn instead of the whole chat
  - era rename, merge and split
- **2D UI:** story feed with animated command chips, a dice card, the composer mode chip + dice tray, a HUD side panel, and the Journal screen (Lore, Quests, People, Inventory).
- **Done when:** a playable adventure where the GM changes state only through validated commands, every change persists, `[bracket]` questions never change state, and the books fill up as you play.
- **Status (2026-10-29):** 2A–2D built. Typecheck, 132 unit tests (mock models), build and a 10 s smoke launch pass. Still open: one live Gemini turn (native tools) and one live CLI turn (text protocol), plus your click-through.

### Phase 3: Conversation UI
- Anime-style speech bubbles: NPC portrait, name plate, typewriter reveal, emotion tag (shaking bubble for shouting, faded for whispers), narrator boxes vs character bubbles.
- Multi-NPC scenes: the GM tags each line with a speaker, and the bubbles stack per character. A "talk to" focus picks which NPC you address.
- Painterly theme tokens are set here (colors, fonts, frames).
- **Done when:** a scene with 3 NPCs talking reads like a visual novel.
- **Status (2026-10-29):** built.
  - **Dialogue:** the GM tags spoken lines in its narration as `@Name (emotion): "…"`, with 10 emotions.
  - **New command:** `move_character`, so companions can follow the player.
  - **On screen:** parchment narrator boxes, gilded name plates, emotion-styled bubbles, a typewriter reveal (Settings → Text speed), a scene strip and a "Talking to" focus.
  - **Checked:** typecheck, 149 unit tests, and the Playwright e2e (`pnpm --filter @dnd/desktop e2e`, with a scripted demo GM via `DND_DEMO_GM=1`) pass.
  - **Still open:** live Gemini and CLI turns using the tags.

### Phase 4: Inventory, items, currencies + loot animations
- Grid inventory, item rarity frames, stacking, equip slots, multiple currencies (e.g. copper/silver/gold plus world-specific ones), item detail cards.
- Icons: a bundled icon set first, generated icons later (Phase 10).
- **Loot events:** in Story mode, when you say "I find a glowing sword in the chest", the GM calls `grant_item`, the engine fires the loot event, and the chest-opening or item-reveal animation plays with that exact item (name, rarity, icon).
- **Done when:** declaring loot in Story mode plays the animation and the item appears in the inventory.
- *Decision 1:* the grid and loot animation read the Phase 2 item template (type, rarity, icon, stats, effects, value). The basic inventory list arrives in Phase 2.
- **Status (2026-10-29):** built.
  - **Engine:** 11 equip slots derived from the item's type and icon (`equipment.ts`), a purse that makes change (`purse.ts`), and the commands `equip_item`, `unequip_item` and `introduce_currency`.
  - **On screen:** an Inventory screen in the rail (paper doll, a filtered and sorted grid, a detail card, the purse), and a chest-opening reveal per granted item, with rarity frames (legendary shimmer, mythic prism) and a coin shower.
  - **Checked:** typecheck, 167 unit tests, and both Playwright e2e tests (`scene` and `loot`) pass.
  - **Still open:** live Gemini and CLI loot turns.

### Phase 5: DnD mode — character sheet + dice
- Game mode toggle per campaign: Story vs DnD.
- Character sheet: attributes, skills, HP/resources, level/XP. Rules are D&D-inspired but simplified, and data-driven so each world's power system can plug in.
- `request_check` → 3D dice roll with modifiers → crit/fail effects → the GM narrates the result. Advantage/disadvantage, contested rolls.
- Light combat: initiative, turns, actions using the power system, and enemy HP managed by the engine.
- **Done when:** a DnD-mode scene with skill checks and a short fight resolves entirely through engine dice.
- *Decision 3:* the app-owned roller, checks and 2D dice card come in Phase 2. Phase 5 adds 3D dice, real modifiers from the sheet, and combat.
- **Status (2026-10-30):** built.
  - **Engine:**
    - A data-driven ruleset (`ruleset.ts`): 18 skills, point-buy, proficiency, an XP table, weapon dice.
    - The hero sheet (`sheet.ts`): HP, AC from gear, skills, saves, powers, a resource, death saves, levelling.
    - Engine-run combat (`combat.ts`): initiative, enforced turn order, attacks, crits, defend, flee, auto death saves.
    - Pending rolls (`pending.ts`), so the player rolls their own checks and attacks.
    - New commands: `award_xp`, `change_hp`, `rest`, `learn_power`, `start_combat`, `combat_action` and `end_combat`.
    - Checks now use the sheet, support saves and contested rolls, and refuse unknown skills.
  - **AI:**
    - The GM writes hero options that fit the world (`archetypes.ts`). The 5 built-in ones are used when it can't.
    - The DnD prompt carries hero and fight lines.
    - DnD-only tools are hidden in Story mode.
    - The roll ledger stores raw RNG values, so a retried turn replays its damage dice too.
  - **On screen:**
    - A hero setup step: GM options plus point-buy.
    - A Hero screen and a HUD hero panel.
    - A Story/DnD switch in the Adventure header.
    - A three.js die that lands on the engine's number (2D fallback).
    - An attack card and a combat tracker with floating damage.
    - Rolls from earlier turns stay in the story as settled cards.
  - **Checked:** typecheck, 216 unit tests, and the 3 Playwright e2e tests (`scene`, `loot`, and `dnd`: hero setup, a check on the 3D die, a goblin fight to XP, the Hero screen, switching to Story).
  - **Still open:** live Gemini and CLI DnD turns (GM-written hero options, checks, a fight).

### Phase 6: Worlds, lore, power systems + world wizard
- Data model for the world: regions, factions, history, gods, races, and the **power system** (sources, ranks or tiers, costs, limits, ability templates).
- **Lore Codex** UI: entries unlock as you discover them, and the GM can reference them.
- 1–2 handcrafted **preset worlds**.
- **AI World Wizard**: asks a few short questions (tone, tech level, magic style, threats), then generates the world and power system as structured JSON that you can edit before accepting.
- **Done when:** you can start a campaign in a preset world or in a wizard-generated one.
- *Decision 2:* the Lore Codex merges into the Lore Book. A world's preset history becomes "Era 0".
- **Status (2026-10-30):** built.
  - **Engine:**
    - The world holds its tone, regions, factions, gods, races, Era 0 history and power system. The power system has sources, a resource, ranks by level, limits and power templates.
    - The world's rules (`world.rules`) can rename the six abilities and replace the skill list; classic rules are used when there are none.
    - Checks, hero creation and `learn_power` validate against the world (`world.ts`: `rulesOf`, `checkPower`, `normalizeArchetype`).
    - **Codex:** entries start hidden. `reveal_lore` unlocks them; `move_to` reveals regions and `introduce_character` reveals factions and races. `lookup_lore` searches the codex too.
    - `createCampaign` takes a world draft (`WorldDraftSchema`).
  - **Content:** new `packages/content` with two presets:
    - *Aurelion, the Sunlit Kingdoms*: classic rules, Resonance magic.
    - *The Ashen Reach*: renamed abilities, its own 14 skills, Hemocraft.
    - Each has five built-in heroes.
  - **AI:**
    - The GM prompt gets a `## World lore` block (≤ 3500 characters, with ✓/✗ for what the player knows).
    - Hero options use the world's rules and power system; classic heroes are fitted to custom rules.
    - World Wizard (`worldWizard.ts`): five questions; four sections written, validated and retried one at a time; a demo sample world, "The Glass Marches".
  - **On screen:**
    - "Choose your world" on the new-adventure card.
    - The World Wizard: questions, progress, editable review cards with "Write again", then accept.
    - The Journal's Lore Book opens with Era 0; a new Codex tab shows locked and unlocked entries, with "New" sparkles.
    - A codex chip and toast during play.
    - Hero setup, the Hero sheet and dice cards use the world's ability and skill names.
  - **Checked:** typecheck, 247 unit tests, and 5 Playwright e2e tests (`scene`, `loot`, `dnd`, plus `worlds`: an Ashen Reach DnD campaign with a codex reveal and Era 0, and a wizard world edited before starting).
  - **Still open:** live Gemini and CLI world generation and codex reveals.

### Phase 7: Character creation, relationships, routes
- **Character wizard**: the same question-driven flow for your own power (within the world's power system), background, appearance (portrait generated later), and starting side characters with a preset relationship to you.
- **Relationship system**: per-NPC affinity, trust and fear values, relationship tags (rival, friend, love interest…), memories of key events, and faction reputation. The GM gets a compact relationship summary in context.
- **Routes** (mainly for DnD mode): Romance, Revenge/Dark Fantasy, Horror, Chill/Wholesome, Harem, and more. A route steers the GM's story focus (prompt directives, encounter weighting, NPC behavior) and can be changed in settings mid-campaign. A content-intensity setting goes with it.
- **Done when:** your side characters react differently based on relationship values, and switching the route visibly shifts the story.
- *Decision 2:* the relationship data, AI-proposed updates and the People tab come in Phase 2. Phase 7 adds romance and other aspects, faction reputation, and routes on top.
- **Status: done.**
  - **Engine:**
    - A `romance` aspect (same caps as the others).
    - Bond stages in `bonds.ts`: Stranger → Acquaintance → Friend → Close → Devoted; Sweetheart and Partner; Rival and Enemy. A `bond-changed` event fires when the stage moves.
    - Bond presets for companions (`BOND_PRESETS`).
    - Faction reputation in `reputation.ts`: a baseline from the faction's attitude, seven tiers, and `adjust_reputation` (±10 per call, ±15 per faction per turn; reveals the faction).
    - `set_companion`; companions follow `move_to`.
    - `createCharacter` (`character.ts`): name, pronouns, background, appearance, power source, and up to 2 companions.
    - Story routes and intensity in `routes.ts`: 8 routes, 3 intensities, and intimacy always fades to black.
    - Old saves load as already set up.
  - **AI:**
    - The GM prompt gets an identity line and a `## Story route` section (route, scenes, NPC behaviour, intensity).
    - Relationship cards show the bond stage and how to play it; "Travelling with you"; a companion banter rule; your standing on known factions.
    - `characterWizard.ts`: the GM fleshes out answers and proposes 3 companions, with fallbacks.
    - Demo GM: route-flavoured openings, "How do you feel about me?", "I help the guard".
  - **On screen:**
    - Character setup (identity, then companions) opens before the first turn in both modes; DnD hero setup follows.
    - Route cards and an intensity switch on the new-adventure card, plus a route button and dialog in the adventure header.
    - People: bond-stage and companion badges, a romance bar, and a Standing section. The Codex shows your standing.
    - Chips for bond, reputation and party changes.
  - **Checked:**
    - Typecheck and 271 unit tests.
    - 6 Playwright e2e tests: the earlier 5, now going through setup via `e2e/setup.ts`, plus `characters`: a Romance campaign with a love interest, a stage-aware reply, the People tab, and a switch to Horror that changes the next scene.
  - **Still open:** live Gemini and CLI character setup, companion generation and route-steered play.

### Phase 8: Quests + world map
- Quest journal: main and side quests, objectives, rewards. The GM uses `start_quest`, `update_objective` and `complete_quest`.
- World map: a region image with location pins, discovered or undiscovered (fog), the current position, travel that advances time, and quest markers.
- **Done when:** taking a quest adds a map marker, and traveling there moves the clock and the scene.
- *Decision 2:* the Quest Book (and the `start_quest`/`update_quest` commands) comes in Phase 2. Phase 8 adds the map.
- **Status: done.**
  - **Engine (`map.ts`):**
    - Places get map positions and a `visited` flag; quests get a destination (`locationId`).
    - The GM gives a direction (n…nw) and a distance (next-door … far); the engine places the pin (radius grows with √minutes, never on top of another pin) and works out walking time.
    - `move_to` now moves the clock by the journey itself and turns a rumoured place into a visited one.
    - New `mark_place` (a rumoured place under fog); `start_quest`/`update_quest` take `place`, and `start_quest` also `newPlace`.
    - Places from older saves are drawn on a ring around the first one.
  - **AI:**
    - The prompt lists places nearest first with "(rumoured, ~6 h north)", and quests with "→ destination".
    - Demo GM: "I take the job" (quest + the Old Mill under fog), "I travel to X".
  - **On screen:**
    - A Map screen (nav "Map"): a parchment SVG with region tints, fog over the unknown, a pulsing "you are here", "?" pins for rumours, gold "!" quest markers, a dotted route with the travel time, and a place card with "Travel here" (sent as a turn).
    - The HUD Location panel links to the map; Quest Book cards show their destination and open the map on it.
    - Chips: "New on your map", and travel time on the move chip.
  - **Checked:** typecheck, 281 unit tests, and 7 Playwright e2e tests, including the new `map`: take the job, see the marker, travel, and the clock moves about 6 h.
  - **Still open:** live Gemini and CLI play with directions, distances and quest destinations.

### Phase 9: Long-campaign memory
- Rolling summaries (a cheap model summarizes old turns), entity memory per NPC and location, and retrieval of relevant lore and events into the prompt, so 100+ hour campaigns stay coherent and affordable.
- **Done when:** after a long session, the GM correctly recalls early events and NPCs.
- *Decision 2:* the core memory (Lore Book + eras + conversation summaries) moved to Phase 2. Phase 9 is now about quality: embeddings, re-summarizing, and recall tests over long campaigns.
- **Status (2026-10-31): built.** Compaction without forgetting:
  - **Layers:** a few turns go word for word; older ones are compacted by the Scribe into **digests** plus **facts** about people and places (`packages/ai/src/compactor.ts`). Era summaries now read the digests too. Nothing is deleted: every turn stays in the save.
  - **Recall** (`recall.ts`): BM25 over Lore entries, digests, facts and old turns (long turns return their best ~300-character excerpt), blended with embeddings when a Gemini or OpenAI key exists (`embeddings.ts`, `main/memoryIndex.ts`; a 1.5 s query timeout falls back to keywords).
  - **Presets** (`memoryPresets.ts`, Settings → Game Master → Memory): Thrifty 3 turns + digest every 4 · Balanced 6 + 6 (default) · Rich 12 + 8, each with its own memory budget and recall hits. A "Semantic recall" toggle sits beside it.
  - **Caching:** the system prompt is split into a stable prefix (persona, rules, world) and a per-turn part (state, memory). Anthropic gets the prefix marked for caching; Gemini and OpenAI cache it on their own.
  - **Cost:** every turn saves its tokens (`turns.usage_json`; CLI turns are estimated at ~4 characters a token). The play screen shows a meter per turn, and the Game Master tab shows "This campaign: N turns · digests · tokens sent, % from cache".
  - **Save format:** new `digests`, `memory_facts` and `embeddings` tables, plus `turns.usage_json` and `turns.day`, all added in place to old saves.
  - **Checked:** typecheck; 314 unit tests, including a 300-turn campaign where a day-1 debt is recalled at turn 300 on every preset, with the request at turn 300 within 10% of turn 100 (the memory block fills up to its budget over the first few dozen turns, then stays flat); 8/8 e2e tests (new `memory.e2e.ts`).
  - **Still open (needs you):** recall quality over a real long Gemini or CLI session, and the real cache and embedding savings.

### Phase 10: Generated art (images + 3D)
- `AssetGenerator` interface with Wavespeed (images: portraits, item icons, location art, maps) and Meshy (3D items and characters for the inspect view) adapters, plus an **MCP client** so any MCP image or 3D server can plug in.
- A per-campaign style lock (the same art style prompt and seed) keeps the anime look consistent. A local cache means each asset is generated only once.
- **Done when:** a new NPC gets a portrait automatically, and a new legendary item gets an icon and an optional 3D preview.
- *Decision 1:* generated icons replace the item template's catalog `icon`, and the catalog icon stays as the fallback.
- *Decision (2026-10-31):* images come from Gemini (with no model chosen, the newest image model on the key, from Google's live list; 2.5 was retired) and Wavespeed, 3D from Meshy (items and characters). Art is drawn automatically at key moments, within a per-campaign cap. The MCP client moved to Phase 11.
- **Status (2026-10-31): built.**
  - **Engine** (`art.ts`): asset ids on `Character.portrait`/`model3d`, `Player.portrait`, `Location.art` and `InventoryItem.art`/`model3d`; `campaign.artStyle` is the style lock (preset + custom text + seed; a seed of 0 is derived from the campaign id). `artWanted` picks the auto jobs from committed events: the hero after setup, new people, rare-or-better items, new places. 3D is for characters and legendary or mythic items.
  - **AI** (`packages/ai/src/art/`): prompts that start with the style text and say "no text"; Gemini, Wavespeed (submit → poll → download) and Meshy (image-to-3D from the picture) adapters; demo generators (SVG badges, a small GLB) for `DND_DEMO_GM=1`. New connection kinds `wavespeed` and `meshy`; each kind lists what it makes (`KindInfo.uses`).
  - **Main** (`main/art/`): a cache at `<userData>/art/<campaignId>/<sha256>.<ext>` (each asset is paid for once), the `dnd-art://asset/<campaignId>/<file>` protocol (only hash names, CORS for the 3D viewer), and a background queue (2 at a time) that lands art on the latest campaign state and reports progress as `art` events. Settings: `routes.image`, `routes.model3d`, `art.auto`, `art.autoCap` (60).
  - **Renderer:** portraits in bubbles, the scene strip, the composer, People cards, the HUD and the Hero sheet; item icons everywhere items show; a place banner on the map card and the HUD; Generate/Redraw and 3D preview buttons; a lazy three.js viewer; Settings → Art (picture and 3D chains, auto art and cap, the campaign's style lock).
  - **Checked:** typecheck; 342 unit tests; 9/9 e2e tests (new `art.e2e.ts`: hero and tavern portraits, rare and legendary icons, the amulet's 3D model, the style lock).
  - **Still open (needs you):** real Gemini and Wavespeed pictures and how well the style lock holds; a real Meshy run (about 20–30 credits).

### Phase 11: Subscription bridges + MCP server mode
> The text-only CLI bridges shipped in Phase 1. What's left here: exposing the GM tools to the CLIs through a local MCP server, and the optional MCP server mode.

- **CLI bridge adapters**: run your locally installed **Claude Code** (`claude -p`, streaming JSON) or **Codex CLI** (`codex exec`) headless, so turns run on your own Claude or ChatGPT subscription. Game tools are exposed to the CLI through a local MCP server.
  - ⚠️ Caveat: subscription use outside the official apps is governed by Anthropic's and OpenAI's terms, which change. API keys are the officially supported route. We check the current terms before building this.
- **MCP server mode** (optional): the game exposes its state and tools as an MCP server, so you could also run the GM from Claude Desktop or ChatGPT.
- **Done when:** the GM runs through the Claude Code CLI with no API key set.
- *Decision 4:* Gemini is the main provider. Until this phase, the CLIs use the Phase 2 `<<<ACTIONS>>>` text protocol instead of native tools.
- *Decision (2026-10-31):* this phase builds the CLI tools over MCP for both Claude Code and Codex, with the text protocol as an automatic fallback. MCP server mode and the art MCP client are deferred. Terms: Anthropic allows `claude -p` on your own subscription (since 2026-06-15 it draws on a separate monthly Agent SDK credit); apps may not offer subscription access to other users. Settings shows a one-line note.
- **Status (2026-10-31): CLI tools built.**
  - **Tool server** (`packages/ai/src/mcp/toolServer.ts`): one local MCP server (Streamable HTTP, `@modelcontextprotocol/sdk`) per attempt, on `127.0.0.1` under a random secret path. It refuses other hosts and any `Origin`, and runs each call through the same `CommandSession` as native tools (`turn/tools.ts` `gmTools`). Roll results add a note so the model narrates the outcome; a call waits for the player's die click.
  - **CLIs** (`providers/cli.ts`): Claude Code gets `--mcp-config` + `--allowedTools mcp__dnd` (built-in tools stay off); Codex gets `-c mcp_servers.dnd.*` overrides with its tools pre-approved. Tool timeouts are 10 minutes. A new model message after a tool call starts a new paragraph.
  - **Runner** (`turn/mcp.ts`, protocol `'mcp'`): if the CLI never connects, the attempt stops before any text shows and the same CLI retries with the text protocol, which is then used for that connection for the rest of the session. Settings → Game Master → "CLI game tools" turns MCP off.
  - **Checked:** typecheck; 356 unit tests; 9/9 e2e tests, with the demo GM now playing every scene over real MCP (including rolls and fights). One live turn each: Claude Code (haiku) called `adjust_currency`; Codex called `move_to` and `adjust_currency`. Both went through MCP with no fallback.
  - **Still open:** MCP server mode (run the GM from Claude Desktop or ChatGPT) and an MCP client for art servers.

### Phase 12: Polish
- Sound effects and music (per-scene ambience), save slots, export and import of worlds, accessibility (text size, reduced motion), performance, packaging and an installer (electron-builder).
- *Decision (2026-10-31):* bundled CC0 audio plus synthesized ambience, save points per campaign (rather than save slots), and an NSIS installer.
- **Status (2026-10-31): done.**
  - **Sound:**
    - 11 Kenney CC0 effects and 3 OpenGameArt CC0 loops (credits in `renderer/src/assets/audio/CREDITS.md`), with procedural ambience and music for each scene.
    - Sound tab: volumes, mute, mute in background. Ctrl+M mutes.
  - **Save points:** named and automatic (every 25 turns and on era change; the newest 10 automatic points are kept). Rewind keeps a "Before a rewind" point, and Branch starts a new campaign.
  - **Accessibility:** the Modal focus trap and focus restore, an aria-live announcer for new turns, and the story feed as a focusable log. axe finds no serious or critical WCAG A/AA issues.
  - **Performance:** screens load lazily. The startup bundle went from 1.97 MB to about 1.75 MB; three.js (1.36 MB) loads only for 3D.
  - **Packaging:** `pnpm dist` builds the NSIS installer and a portable exe. They are unsigned, so SmartScreen asks "Run anyway".
  - **Single instance:** only one copy of the app runs at a time.

### World packs (2026-10-31)
> Your request: import and export preset worlds with lore, power system and story direction, and preset characters you can edit or replace with your own.

- **One `.dndworld` file** (`WorldPackSchema`, documented in `docs/WORLD-PACKS.md`) holds:
  - the world draft, plus `premise`, the story direction the GM steers toward;
  - the story route and intensity defaults;
  - up to 12 preset playable heroes, each with up to 2 companions.
- **Home:** "Import world…" plus Export and Remove on each card. Picking a pack preselects its route.
- **Character setup:**
  - starts with "Choose your hero" (the pack's heroes, or "Create my own"); everything stays editable;
  - companions can be edited, and "Write my own companion" adds one from scratch;
  - DnD hero setup preselects the preset's archetype and scores.
- **Journal → Codex:** "Export this world…", optionally with your hero as a preset.
- **Built-in presets** are `packages/content/src/packs/*.ts`. The two existing worlds are packs now; new presets go there.

### Visual novel mode (2026-10-31)
> Your request: an optional visual-novel way to play, for almost any story type, with consistent emotion faces made from one picture of each character.

- **Turning it on:** "How should it look?" on Home (packs can preselect it), and Classic / Visual novel in the Adventure header.
  - Stored as `campaign.presentation` (`style`, `choices`, `themeFaces`).
- **The stage** (`screens/adventure/novel/`):
  - the place's picture (or a scene gradient) as the backdrop;
  - the people here as framed busts, with whoever speaks raised and lit;
  - one page at a time in the text box: a name plate, the typewriter, then click, Space or Enter;
  - **Log** shows the whole story.
  - The GM's choices come after the last page (`offer_choices`, keys 1–4). "Something else…" opens the normal composer.
  - Setup, loot, fights, dice and the side panel work as in classic play. A saved turn reopens on its last page.
- **Faces:**
  - The core six (neutral, happy, sad, angry, surprised, tender), plus faces that fit the story route:

    | Route | Extra faces |
    |---|---|
    | romance | flustered |
    | horror | terrified, disgusted |
    | revenge | furious, disgusted |
    | mystery | suspicious |
    | classic | determined |

  - A world can add up to 4 more.
  - Each face is an **edit of the character's portrait** (Gemini image editing), so it stays the same person. Faces are drawn the first time a character shows that emotion, within the auto-art cap; until then the portrait shows.
  - Journal → People shows each face with Redraw.
- **Your own pictures:** "Use my own picture…" sets a character's or the hero's portrait (PNG, JPG or WebP, ≤10 MB). The old faces are cleared, so new ones come from your picture.
- **World packs** can set `presentation` and carry `portrait` pictures for preset heroes and companions (data URLs, ≤1.5 MB each; packs ≤25 MB). Exporting with your hero embeds their pictures.

---

## Verification (applies to every phase)
- `pnpm test`: the engine rules are pure and fully unit-tested (state changes, dice math, bracket mode never changes state, fallback chain).
- `pnpm dev`: launch once per change to check the UI. Playwright Electron e2e from Phase 3 on: `pnpm --filter @dnd/desktop e2e` (builds, plays a scripted scene, a loot scene and a DnD check + fight with the demo GM, screenshots in `apps/desktop/e2e/results/`).
- A mock AI provider with scripted tool calls lets the game loop and animations be tested without spending tokens.

## Status
Phases 0–12 and world packs are done (MCP server mode and the art MCP client are deferred). Next: the preset worlds and heroes you specify.
