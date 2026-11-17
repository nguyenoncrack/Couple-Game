# DJ deck

Branch: `feature/dj-deck` (from main `5092d49`). Nothing is merged, pushed or deployed until approved.

The party's music dock was a big YouTube video with a row of pill buttons. It's now a game-style DJ console that plays the game's own music.

## Only while your sim works the gear

Nothing about the party is on screen otherwise: no Party button, no panel, no bar.

- **DJ booth** ("Work the decks"): when your character reaches the booth, the full DJ console opens.
- **Music player** ("Play some music", a new `tune` action with one place in front of the player): a simpler console in the same style. It shows the record on air, Play/Pause, Skip and the crate, where a pick goes straight on air.
- Both have a **Lights** tab when the house has party lights or a dance floor: on/off, brightness, laser spread, Steady, the four looks and one colour. These are the old party panel's controls, restyled to match the deck.
- **Step away** (on the console, or "Step away" on the gear's menu) ends the action and puts the controls away. The music plays on.
- Dancing is from a dance-floor tile's menu, as before. The party panel's "dance where you are" is gone.

The music is heard by everyone in the house whenever the deck plays. There is no "join" step: like the game's lo-fi music, it starts on your first click or key press, and the game's music switch silences it. The lo-fi music steps aside while it plays.

**YouTube is gone from the game.** Its client code (player, sync planner, queue panel) is removed. The server still accepts the old YouTube commands and keeps any queue a house saved, so old saves load. Nothing on screen sends those commands any more.

## The console

- **Two turntables**: each record turns while the deck plays (at the deck's tempo), with the record's name and an eight-cell level meter fed by that deck's real output.
- **Screen**: shows what's on air, the section (Intro, Groove, Full, Breakdown, Rising, Build-up, Drop!), four beat lights and the 32-bar phrase.
- **Mixer**:
  - *Play/Pause* pad.
  - *Crossfader* (A to B, equal power; double-click centres it).
  - *Filter* knob (left muffles, right thins; drag, arrow keys, or double-click to reset).
  - *Echo* pad.
  - *Drop* pad: a two-bar build-up with a snare roll and a riser, then a four-bar drop with a crash.
  - *Tempo*: −/+ 2 BPM, from 100 to 140.
- **Record crate**: six records. Clicking one loads it onto the *cued* deck (whichever the crossfader is away from), as a DJ would.
- **Just you**: volume, Mute and Fade (quieter away from the speakers).

Everything on the deck is shared and synced through the house, except the "just you" row.

## The music

The six records are Neon Drift (house), Sunset Loop (deep house), Pillow Fort (lo-fi house), Rain on Glass (chill), Disco Kettle (nu-disco) and Night Bus (techno).

- They're written as patterns in `features/party/deck/tracks.ts`: drums, bass, lead and a four-bar chord run.
- They're synthesized in Web Audio on each screen (`deckEngine.ts`), so nothing is downloaded or streamed.
- All are in A minor, and both decks always share one tempo and one beat, so any crossfade sounds right.
- Each record goes round a 32-bar phrase: intro, groove, full, breakdown, rise. A drop takes over for its build and drop.

**Sync.** The house keeps an anchor: at server time `t` the beat was `beat`, at `bpm`. Each screen schedules notes about 160 ms ahead, at the audio time that matches the server time of their sixteenth. Both players hear the same note at the same moment. Any change of tempo, play or pause re-anchors, so the beat never jumps. A drop starts on the next bar line and is stored in beats.

**Saving.** The deck is saved paused at its beat, with its records and mix. A house saved before the deck existed gets a fresh one.

## Music gear moves with the music

| Gear | What it does while music plays |
| --- | --- |
| Speakers | The woofer cone, its cap and the tweeter thump forward on each kick, outlines included. This is a `push` option on the pencil material, in the model's own space. The lit ring brightens on the kick. |
| Music player | The display is a seven-bar equaliser in the party colours that jumps with the beat. The grille slats nudge out. |
| DJ booth | The records turn at the deck's tempo. The mixer's level lights follow each deck (A left, B right). The lit front pulses. |
| Dance floor, LED strips | A gentle brightness lift on each kick. |

What drives it: the deck's own beat. The kick is out during the breakdown and the build, so the speakers rest then.

Steady light stops the pulses. A device that asks for reduced motion stops the cones and the record spin.

## Files

- **Shared:**
  - `catalog/party.json`, `catalog/index.ts`, `life/needs.ts`: the music player's `tune` place and what it does for fun.
  - `party/deck.ts`: tracks, deck state, beat clock, sections, pump.
  - `party/definitions.ts`: the `deck` and `drop` commands, `PartyState.deck`.
  - `party/reducer.ts`: deck commands, taking turns, save and restore, holding when the house empties.
- **Client:**
  - `features/party/deck/`: engine, tracks, console (`DjConsole.tsx`, with the booth and music-player pages), lights page (`LightsPage.tsx`), styles.
  - `MusicDock.tsx`: runs the engine and the spatial mix, and shows the console only while your sim works the gear.
  - `partyHooks.ts`: `useGearInUse`, `usePartyGear`, `useSlider`.
  - `tools/LiveTools.tsx`: the "Play some music" verb; the old "Light controls…" and "Music…" menu items are gone.
  - `render/pencil.ts` and `render/kit.ts`: the `push` option.
  - `render/party/*`: pulse uniforms, the equaliser and level-light materials, model changes.
- **Tests:**
  - `shared/__tests__/deck.test.ts`
  - `client/features/party/deck/deck.test.ts`
  - the server wire test in `server/__tests__/party.test.ts`
