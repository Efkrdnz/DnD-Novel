# multimine.md

Project guidance for every chat in this project, whichever model runs it. Edit it freely: it is
added to every chat's system prompt, the way CLAUDE.md or AGENTS.md is.

## Project

Single-player desktop fantasy RPG with an AI game master (Story mode + DnD dice mode).
Full phased roadmap: `docs/PLAN.md` — build one phase at a time, user reviews between phases.

- pnpm monorepo. `packages/engine` = pure TS game rules + Zod schemas (no I/O): campaign schema v2 + `parseCampaign`
  (migrates old saves), item template, app-owned dice, `classifyInput` ([brackets] = out-of-character), the GM command
  set in `src/commands/` (one Zod schema + pure handler each), `Turn` (a transaction; OOC turns never change state)
  and era edits in `eras.ts`.
  `packages/ai` = providers (AI SDK + Claude Code/Codex CLI bridges), fallback chain, GM prompt, `memory.ts` (Lore Book
  memory block) and `turn/` (`runGameTurn`: native tools for HTTP providers; the CLIs call the same tools over a per-attempt local MCP
  server, `mcp/toolServer.ts` + `turn/mcp.ts`, and fall back to the `<<<ACTIONS>>>` text protocol if they cannot connect;
  fallback only before visible text or an applied command; `RollLedger` reuses rolls on retry). Main process only,
  except `@dnd/ai/kinds` (pure metadata, safe for the renderer).
  `apps/desktop` = Electron (electron-vite): `src/main` (saves, settings, encrypted keys, `turns.ts` turn service,
  `scribe.ts` era summaries, IPC), `src/preload`, `src/renderer` (React + Tailwind v4 + motion; building blocks in `ui/`,
  screens in `screens/`, the play screen in `screens/adventure/`, the Journal in `screens/journal/`, the Inventory in
  `screens/inventory/`).
- Items: equip slots come from the item's type + icon (`packages/engine/src/equipment.ts`, `equippedSlot` on the item).
  Money is value-based: `purse.ts` `pay()` makes change, so the GM may price in any coin. Loot reveals play from the
  committed turn's `item-granted` events (`useTurns` → `LootReveal.tsx`), so a rolled-back turn shows none.
- DnD mode: rules data in `packages/engine/src/ruleset.ts`, the hero sheet in `sheet.ts` (`player.sheet`, null until
  the setup step), fights in `combat.ts` (`campaign.encounter`; the engine enforces turn order and rolls for foes), and
  rolls the player clicks in `pending.ts` (`Turn.resolvePending`). Built-in hero options: `archetypes.ts`. The 3D die
  (`ui/dice3d/Dice3D.tsx`, three.js) is lazy-loaded and lands on the engine's number; never roll in the renderer.
- Worlds: `WorldSchema` holds the codex (regions, factions, gods, races), Era 0 `history`, `powerSystem`, `rules`
  (null = classic) and `revealed` ids. Always get skills and ability names through `rulesOf(campaign)`
  (`packages/engine/src/world.ts`), never the global `SKILLS`. Preset worlds live in `packages/content` (validated
  `WorldDraft`s); the World Wizard is `packages/ai/src/worldWizard.ts` (renderer-safe via `@dnd/ai/wizard`) with
  `main/worlds.ts`; the demo GM answers it with `worldWizardDemo.ts`.
- Characters and bonds:
  - `player.setupDone` is false on new campaigns. Until it is true, `CharacterSetup.tsx` (`screens/character/`) covers the play screen. It saves through `createCharacter` (`packages/engine/src/character.ts`); the GM helpers are `packages/ai/src/characterWizard.ts` (renderer-safe via `@dnd/ai/character`) and `main/characters.ts`.
  - Bond stages and companion presets live in `bonds.ts`, faction standing in `reputation.ts`, and story routes and intensity in `routes.ts` (`campaign.storyRoute`, `campaign.intensity`; `settings.routes` is the AI chain, not this).
  - Companions are `Character.companion` and follow `move_to`.
  - Custom expressions: `presentation.customFaces` (≤6, `{id, name, look}`) beside the 16 built-in emotions; `addExpression`/`removeExpression`/`faceKeyFor`/`faceLook` in `presentation.ts`. A tag with an unknown emotion carries it as `Segment.custom`; faces are keyed by emotion or custom id. The GM adds one with `add_expression` while `presentation.gmFaces` is on. The player edits them in Journal → People (`Expressions.tsx`).
  - The player edits anyone later through `editCharacter`/`editHero` (`character.ts`) and IPC `character:edit`, from Journal → People (`EditPerson.tsx`, with a hero card). A rename keeps the old name in `Character.aliases`, so `resolveSpeaker` still matches older lines.
- World map:
  - `packages/engine/src/map.ts` holds positions (`positionOf`; null x/y = drawn on a ring), placement from a direction and distance (`newPlace`/`placeFrom`), and walking time (`travelMinutes`, `describeTrip`).
  - `move_to` advances the clock itself. `visited: false` = a rumoured place (`mark_place`, a quest's `newPlace`).
  - The screen is `screens/map/WorldMap.tsx`; "Travel here" sends a `Draft` with `autoSend` through `App.tsx`.
- Long-campaign memory:
  - A turn sends only the turns not yet compacted (`transcriptWindow`, capped by the preset in `packages/ai/src/memoryPresets.ts`, `settings.gm.memory`).
  - After each commit the Scribe (`main/scribe.ts`) folds older turns into digests and facts (`compactor.ts`), then refreshes era summaries.
  - Recall: `recall.ts` (BM25, plus vectors if present) via `main/memoryIndex.ts`, which also embeds digests, facts and Lore in the background when `gm.semanticRecall` is on and a Gemini or OpenAI key exists.
  - `assembleMemory` adds the sections "Recently", "What you know about people and places here" and "Recalled from earlier".
  - The system prompt is `splitGmSystemPrompt` → `{stable, dynamic}`; keep anything that changes per turn out of `stable`, because it is the cached prefix.
  - Token usage is saved per turn (`StoredTurn.usage`).
- Settings: `<userData>/settings.json` (shape in `src/shared/settings.ts`). API keys: `<userData>/secrets.json`, encrypted
  with safeStorage, and they never reach the renderer.
- Core rule: the engine owns game state; the AI may only change it through validated tool calls.
- Dialogue: the GM tags spoken lines inside its narration as `@Name (emotion): "…"` (parser and emotions in
  `packages/engine/src/dialogue.ts`; rules in `prompt.ts` DIALOGUE_RULES). Stored narration keeps the tags; the
  renderer turns them into bubbles (`screens/adventure/Dialogue.tsx`). Presence = same `locationId` as the player.
- Art: asset ids (file names) on portraits, items, places and `model3d`; `packages/engine/src/art.ts` (`withArt`,
  `artWanted`, style lock `campaign.artStyle`). Generators in `packages/ai/src/art/` (Gemini, Wavespeed, Meshy, demo).
  `main/art/`: `cache.ts` (`<userData>/art/<campaignId>/<sha256>.<ext>`), `protocol.ts` (`dnd-art://asset/<campaignId>/<file>`,
  allowed in the CSP), `artService.ts` (background queue; applies to the latest state; emits `art` events; cap in save meta
  `artGenerated`). Settings: `routes.image`, `routes.model3d`, `art`. Renderer: `ui/art.tsx` (`ArtProvider`, `useArtUrl`,
  `ArtImage`, `ArtActions`), `ui/model3d/Model3DViewer.tsx` (lazy), `screens/settings/ArtTab.tsx`.
- Saves: one sql.js SQLite file per campaign, `<userData>/saves/<id>.dndsave`. Tables: `meta`, `campaign_state` (hot
  state JSON), `turns`, `lore_entries`, `conversations`, `relationship_history`, `digests`, `memory_facts`, `embeddings`
  (+ legacy `messages`, migrated into `turns` once). A complete turn writes state + turn + book rows in one `commitTurn`.
  Save points: `main/saves/snapshots.ts`, whole-file copies in `saves/snapshots/` with a JSON sidecar. An automatic point is made every 25 turns and on era change; the newest 10 automatic points are kept. Rewind and branch are in `screens/adventure/SavePoints.tsx`.
- World packs (`.dndworld`, full format in `docs/WORLD-PACKS.md`):
  - Engine: `packages/engine/src/worldPack.ts` (`WorldPackSchema`, `parseWorldPack`, `packFromCampaign`).
  - Built-ins: `packages/content/src/packs/*.ts`, listed in `PRESET_PACKS`.
  - Imported packs: `main/worldPacks.ts` (`createWorldPackStore`) in `<userData>/worlds/`.
  - IPC: `importWorld`/`exportWorld`/`removeWorld`; the file dialogs open in main.
  - `world.premise` = the story direction, which goes into the GM prompt.
  - `world.heroes` = preset heroes, offered by `HeroChoice.tsx` in character setup; the pick is stored in `player.presetHeroId`. Companions are edited with `CompanionEditor.tsx`.
- Visual novel mode:
  - **Engine:** `campaign.presentation` (`packages/engine/src/presentation.ts`: `setPresentation`, `faceSetOf`, `faceFor`, `facesWanted`, `EMOTION_LOOKS`).
  - **Faces:** `Character.faces` (emotion → asset id), set with `withFace`. `withArt` on a portrait clears them.
  - **Choices:** `offer_choices` (`novelOnly`) emits `choices-offered`.
  - **Main:**
    - Face jobs are `artService.face`/`queueFaces`, queued after each commit in novel campaigns. They edit the portrait with an image generator that has `canEdit` (Gemini; demo).
    - Own pictures: `art:upload` (`main/art/upload.ts`). Pack portraits: `main/art/packPortraits.ts`.
  - **Renderer:** `screens/adventure/novel/` (`NovelStage`, `NovelTextBox`, `Bust`, `pages.ts`), and `ui/art.tsx` (`FacesPanel`, `OwnPictureButton`).
- Sound: `renderer/src/lib/audio.ts` (crossfading layers), `synth.ts` (procedural ambience and music) and `soundscape.ts` (`sceneOf`, `sfxFor`). The CC0 files are in `renderer/src/assets/audio/` (see `CREDITS.md`). Settings: `audio`. The current sound is exposed as `<html data-ambience data-music data-last-sfx>` for tests.
- Packaging: `pnpm dist` runs electron-builder (`apps/desktop/electron-builder.yml`) and makes the NSIS installer plus a portable exe in `apps/desktop/dist/`. The builds are unsigned, so SmartScreen asks "Run anyway". The icon comes from `scripts/make-icon.mjs`.
- Renderer ↔ main contract lives in `apps/desktop/src/shared/ipc.ts`; validate all renderer input in main.

## How to verify

- Build and unit tests: `pnpm typecheck; pnpm test; pnpm build`
- See it running (at most once per change, auto-kill after 10s, temp profile):
  `electron.exe apps/desktop --user-data-dir=<temp dir>` from `apps/desktop/node_modules/electron/dist/` after `pnpm build`.
  For interactive dev the user runs `pnpm dev`.
- End-to-end (also auto-exits; no key needed): `pnpm --filter @dnd/desktop e2e`. It builds, launches Electron
  with a temp profile and `DND_DEMO_GM=1` (scripted GM in `packages/ai/src/demo.ts`, played over the MCP tool server like a real CLI: a 3-character tavern scene, or a
  loot scene when the input says chest/loot/find/found; in DnD campaigns a Perception check, or a 2-goblin fight when
  the input says attack/fight/strike/stab/charge; in any mode, the opening line follows the story route,
  "how do you feel about me" gets a stage-aware answer from a present companion, and "help the guard" raises standing
  with the first known faction; "take the job" starts a quest to the Old Mill, marked under fog; "travel to X" goes
  there). Every new campaign opens character setup, so e2e tests call `finishCharacterSetup`
  (`e2e/setup.ts`). `characters.e2e.ts` checks setup, companions, bond stages and a route switch;
  `map.e2e.ts` checks the quest marker, travel and the clock;
  `memory.e2e.ts` checks the Thrifty preset, the token meters and a digest in the Game Master tab (the demo GM answers compaction
  requests with `demoDigest`);
  `scene.e2e.ts` checks bubbles and the scene strip;
  `loot.e2e.ts` checks the reveal, the Inventory and equipping; `worlds.e2e.ts` checks a preset world (codex reveal when
  the input says "who rules here", Era 0) and the World Wizard (demo sample world); `dnd.e2e.ts` checks hero setup, a check on the 3D die,
  the fight, the Hero screen and the mode switch. `art.e2e.ts` checks auto portraits, item icons, a 3D model and the style lock
  (the demo GM also draws demo art). `saves.e2e.ts` checks sound attributes, a save point rewind and a branch;
  `a11y.e2e.ts` runs axe (legacy mode) and the dialog focus trap; `worldpacks.e2e.ts` imports a pack (file dialogs
  stubbed with `app.evaluate`), plays a preset hero with an edited companion, exports with the hero and removes the pack;
  `novel.e2e.ts` checks the visual novel stage (busts, pages, choices, faces drawn by the demo artist, own picture, the
  classic switch).
  Screenshots go to `apps/desktop/e2e/results/`.
- What that needs first: the Electron binary. pnpm 11 skips its postinstall; if
  `apps/desktop/node_modules/electron/dist/electron.exe` is missing, run `node install.js` inside `apps/desktop/node_modules/electron`.

## Conventions

- TDD: tests first (Vitest). Engine logic stays pure and immutable (return new objects).
- Keep changes small and focused; match the surrounding code.
- When you finish, say what changed and where.
