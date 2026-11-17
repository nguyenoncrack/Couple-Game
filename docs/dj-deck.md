# DJ deck

Branch: `feature/dj-deck`. Nothing is merged, pushed or deployed until approved.

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

- **Two turntables**: each record turns while the deck plays (at the deck's tempo), with the record's name and an eight-cell level meter fed by that deck's real output. Each deck also has:
  - a **place bar**: where the deck is in its record. Click or drag it (or use the arrow keys, Home for the start) to jump to another part. A recording jumps to the moment. A built-in record jumps to the start of a bar so it stays in time with the other deck. At the booth it shows the time to a tenth (`2:40.5 / 4:19`).
  - its own **Play/Pause**: pauses just this deck (the other plays on) and carries on from the same place. Pressing it while the music is paused starts the music with only this deck.
  - a **time box**: type an exact time (`1:24.5`, `84.5` or `1:02:03`) and press Go (or Enter) to jump there.
  - **saved cues**: *Save cue* keeps the typed time (or where the deck is now) as a cue on that record, up to eight. They show as chips (click to jump, × to delete) and as blue ticks on the place bar. Cues belong to the record, so they come back whenever it's loaded, on either deck, and they're shared and saved with the house.
  - a **channel**: Hi, Mid and Low EQ knobs (left cuts the band right out, right lifts it a little; double-click resets) and its own volume.
  - an **eject** (⏏): takes the record off. The other deck plays on its own, and the next record picked goes onto the empty deck.
- **Screen**: shows what's on air, its section (Intro, Groove, Full, Breakdown, Rising, Build-up, Drop!) or a recording's time, four beat lights, how far through the record it is, and a transition under way.
- **Mixer**:
  - *Play/Pause* pad.
  - *Crossfader* (A to B, equal power; double-click centres it).
  - *Filter* knob (left muffles, right thins; drag, arrow keys, or double-click to reset).
  - *Echo* pad.
  - *Drop* pad: a two-bar build-up with a snare roll and a riser, then a four-bar drop with a crash.
  - *Tempo*: −/+ 2 BPM, from 100 to 140.
- **Transitions**: one press takes the music over to the other deck, starting on the next bar line.
  - Five built-in presets: *Smooth* (blend, 8 bars), *Bass swap* (8), *Echo out* (4), *Filter fade* (8) and *Quick cut* (1).
  - Or pick a style and a length (1, 2, 4, 8 or 16 bars) for the *Mix* pad. *+ Save* keeps that as a preset of your own (up to six, on this device, deletable with ×).
  - Styles: *Blend* fades one into the other. *Bass swap* has both play but only one bass line at a time, swapping halfway. *Echo out* sends the old track into the echo as the new one comes up. *Filter out* strips the old track's bass and then its middle, then the new one takes over. *Cut* switches on the bar line at the end.
  - While it runs, the Mix pad fills up bar by bar; pressing it (or grabbing the crossfader) stops the transition where it is. A transition needs the music playing and a record on the other deck.
  - **Timed**: two separate times, when the mix starts on the record on air and where the incoming record starts: "At `2:45` on B ➜ start A at `1:12`", with the chosen style and length, then *Queue*. The incoming deck parks at its cue (its own Play is off; dragging its place bar moves the cue) until the record on air gets there. A queued card shows it ("At 2:45 on B ➜ start A at 1:12 · Bass swap · 8 bars", and how long until it starts) with *Mix now* and *Cancel*. Cancel leaves the incoming deck paused at its cue. Pausing the record on air holds the queued mix; jumping it moves the start, and jumping past the time calls the mix off. A time already gone by can't be queued.
- **My Sets** (a tab at the booth): a set is records in order, each with where it starts, its cue points, and its transition to the next (the time on it, style and length).
  - *In the decks* shows the set being played, or the one your mixing records as you go: every transition you queue or start adds the next record, and calling one off drops it.
  - *Save Set* (separate from *+ Save preset*, which keeps a transition preset) keeps it on this device under a name; saving under the same name updates it.
  - Each saved set has *Load*, *Rename*, *Duplicate* and *Delete* (which asks first). *Load* puts the first record on A at its start and the second parked on B, with the first transition queued, all paused; press Play to replay it. After each transition the next record goes onto the free deck, parked, with the next transition queued.
- **Record crate**: one row that scrolls sideways. Clicking a record loads it onto an empty deck if there is one, otherwise the deck that isn't on air, and it starts from its beginning. Recordings show their length.
- **Just you**: volume, Mute and Fade (quieter away from the speakers).

Everything on the deck is shared and synced through the house, except the "just you" row and your saved transitions.

The music player's simpler console has the place bar too, so you can jump around the song on air there.

## The music

Six built-in records: Neon Drift (house), Sunset Loop (deep house), Pillow Fort (lo-fi house), Rain on Glass (chill), Disco Kettle (nu-disco) and Night Bus (techno). There are also seven recordings (MP3s in `public/audio/dj/`, added separately); the 72-minute live set streams, the rest are decoded whole. Their lengths are written down in `party/deck.ts`, so every screen and the server know them before they load.

Built-in records:

- They're written as patterns in `features/party/deck/tracks.ts`: drums, bass, lead and a four-bar chord run.
- They're synthesized in Web Audio on each screen (`deckEngine.ts`), so nothing is downloaded or streamed.
- All are in A minor, and both decks always share one tempo and one beat, so any crossfade sounds right.
- Each record goes round a 32-bar phrase: intro, groove, full, breakdown, rise. A drop takes over for its build and drop.

**Sync.** The house keeps an anchor: at server time `t` the beat was `beat`, at `bpm`. Each screen schedules notes about 160 ms ahead, at the audio time that matches the server time of their sixteenth. Both players hear the same note at the same moment. Any change of tempo, play or pause re-anchors, so the beat never jumps. A drop starts on the next bar line and is stored in beats.

**Places in a record.** Each deck keeps a cue: the deck beat its record started on, so the record is `beat - cue` "track beats" in (counted at the default 124 BPM, so a tempo change speeds a record up rather than jumping it). Loading a record sets the cue; jumping moves it. A built-in record's cue is always on a bar line. A deck paused on its own keeps a `hold` (where its record stopped) instead: the clock runs on for the other deck, and Play sets the cue so the record carries on from the hold. The master Pause stops the clock itself, so both decks (and a transition) freeze and carry on from the same point. Saved cue points live in `marks`, per record.

**Transitions** are stored as `{style, from, to, start, beats}` in beats, and every screen works out the crossfader and each deck's EQ and echo from them at any beat (`mixAt`). So a transition moves on both screens at once with nothing more sent. Pausing holds it where it is. The next command after it ends writes down where the crossfader finished.

A **timed** transition also has `at` (the place in the outgoing record) and `inAt` (the place in the incoming one). After every deck command the house works out `start` from where the outgoing record is (`null` while that deck is paused on its own), and parks the incoming deck: its cue is set so it is at `inAt` on `start`, and `wait` keeps it there until then (`trackPosition` and the engine both respect it; a parked recording is fetched ahead so it comes in on the beat). *Mix now* sets `start` to now; *Cancel* (`unmix`) turns the park into a hold.

**Sets.** The set in the decks is `set: {name, steps, step}` on the deck, where `step` is the record on air. When a set's transition finishes, any screen sends `setstep` (the house also checks before every deck command). The house then moves `step` on, puts the next record on the deck that's free, and queues the next transition as a timed one. Saved sets live on each device in `cg.party.sets`, and `setload` sends one to the house. Saved cues come back with their records.

**Saving.** The deck is saved paused at its beat, with its records, cues, channels and crossfader. A queued or running transition is saved as it is and carries on from there. A house saved before the deck existed gets a fresh one.

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
  - `party/deck.ts`: tracks and their lengths, deck state, beat clock, sections, pump, channels, cues, transitions (`mixAt`).
  - `party/definitions.ts`: the `deck`, `drop`, `mix`, `cue`, `drop-cue`, `transport`, `mark`, `mixnow`, `unmix`, `setload` and `setstep` commands (`mix` takes optional `at` and `inAt`), `PartyState.deck`.
  - `party/reducer.ts`: deck commands, loading and ejecting, jumping, transitions, taking turns, save and restore, holding when the house empties.
- **Client:**
  - `features/party/deck/`: engine (a three-band EQ and an echo send per deck, set every tick from the channel and the transition), tracks, recordings, console (`DjConsole.tsx`: booth and music-player pages, place bars, channel strips, transitions), lights page (`LightsPage.tsx`), styles.
  - `partyUi.ts`: the transition you've picked and your saved presets (`cg.party.mix` in local storage), and your saved sets (`cg.party.sets`).
  - `deck/SetsPage.tsx`: the My Sets tab.
  - `MusicDock.tsx`: runs the engine and the spatial mix, moves a set on when its transition ends, and shows the console only while your sim works the gear.
  - `partyHooks.ts`: `useGearInUse`, `usePartyGear`, `useSlider`.
  - `tools/LiveTools.tsx`: the "Play some music" verb; the old "Light controls…" and "Music…" menu items are gone.
  - `render/pencil.ts` and `render/kit.ts`: the `push` option.
  - `render/party/*`: pulse uniforms, the equaliser and level-light materials, model changes.
- **Tests:**
  - `shared/__tests__/deck.test.ts`
  - `client/features/party/deck/deckTime.test.ts` (typed times)
  - `client/features/party/deck/deck.test.ts`
  - the server wire test in `server/__tests__/party.test.ts`
