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

The music is heard by everyone in the house whenever the deck plays. There is no "join" step: like the game's lo-fi music, it starts on your first click or key press, and the game's Sound switch (on the phone) silences it; the phone's separate Music switch only turns off the lo-fi background music. The lo-fi music steps aside while it plays.

**YouTube is gone from the game.** Its client code (player, sync planner, queue panel) is removed. The server still accepts the old YouTube commands and keeps any queue a house saved, so old saves load. Nothing on screen sends those commands any more.

## The console

At the booth the console has one **Workspace** tab (plus Lights and Guide): the set list, the waveforms of the transition you're working on, the controls and the suggestions, together. You build a set, work on a transition and play it without changing pages.

- **Live bar** (stays at the top): what everyone hears now (*On air*, its time), what's *Up next* and when it mixes in, and a big Play/Pause.
- **Set list** (beside the decks; on a phone, under the waveforms): the records in order, numbered, each with title, artist and length, and *On air* / *Up next* / *Played* tags.
  - *+ Add songs* opens the library: tick several (they're numbered in the order ticked) and add them in one go. Each new pair is linked at once (`autoLink`, as a suggested mix would).
  - ↑ ↓ reorder and × removes. A record can't move past the one on air, the one on air can't be removed, and while a transition is under way its two records stay put. The transitions a move or removal changes are worked out again and marked *New pair: check it* until you open them, save them, or press ✓.
  - *Save set* keeps the list on this device (same name updates it). *Saved sets* below have *Load* (paused at the first song), *Play* and × (asks first).
  - Between each pair, *Edit mix i → i+1* puts that transition on the waveforms, with "fades at 2:48 · Blend 8 bars" beside it. On a phone it scrolls the waveforms into view.
  - Clicking a row selects it for editing or rehearsal (nothing is sent). *Jump live* moves everyone's music to that record, from its start point, and cues the next record with its transition (`setjump`, or `setload` with a step when nothing from the list is on the decks).
  - Every change to the list goes to the house straight away (`setedit`, below) while the music plays on.
- **The pair**: both records as waveforms (brightness is loudness, colour is how much bass), with timestamps, cue points (yellow), the drop point (pink), bar and phrase lines when the beat is steady, and *Analyzing… n%* until it's known. Each lane says its record's tempo and whether its grid is reliable, and its clock reads *Live 1:02 / 2:52* for the record everyone hears, *Rehearsing 0:31* for one you're previewing, or its length.
  - Click or drag the first lane to set where it **fades** (orange), the second where the next record **starts** (green). Clicks snap to beats when the grid is reliable (Shift-click doesn't); arrow keys nudge. The saved point stays marked *SAVED* while you change it.
  - Plain labels underneath: "Track 4 fades at 1:08 · Track 5 starts at 0:31 · Blend · 8 bars (15.5 s)". Changes are a draft (*Unsaved*) until *Save transition*; *Discard* puts it back. A fade the record on air has already passed can't be saved, and nor can a transition under way. Once the incoming record is on air its start point is fixed.
- **Controls** under the waveforms:
  - *Live · everyone hears*: Play/Pause, Rewind (four bars back on the record on air) and Mix now (starts the queued transition now, or mixes to the other deck).
  - *Only you hear this*: *Cue n* plays the selected record from its start point and *Preview mix* plays the transition from 16 beats before it. Both run on a second, private engine at the deck's tempo; the live mix is turned down to 30% for you, and a note says what you're rehearsing and what everyone else hears. Nothing is sent to the house.
  - *Sound FX* and *Adjust timing* open a compact panel beside the mix (on a phone, under it). Closing it keeps the pair, the playheads and any unsaved changes.
- **Status line**: each command says it's under way ("Saving the 4 → 5 transition…"), then that it landed ("Saved: track 4 fades at 1:08, track 5 starts at 0:31") or that it didn't (after four seconds with no change from the house).
- **Suggestions** for the pair: once both records are analyzed, up to three, in plain words ("At about 1:08 on Track 4, fade in Track 5 from 0:00 over about 15 s.") with a reason. *Pick* puts its two points on the waveforms at once; the picked one has *Preview*, *Rewind preview*, *Adjust timing* and *Save transition*.
- **Sound FX** panel (everyone hears it): crossfader (equal power; double-click centres it), *Filter* knob, *Echo* pad, *Drop* pad (a two-bar build-up then a four-bar drop with a crash), tempo −/+ 2 BPM (100 to 140), and per deck its channel (Hi, Mid, Low EQ and volume) and place bar.
- **Adjust timing** panel: time boxes for "Track 4 fades at" and "Track 5 starts at" (`1:24.5`, `84.5` or `1:02:03`), −/+ beat and bar nudges, style (*Blend*, *Bass swap*, *Echo out*, *Filter out*, *Cut*) and length (1 to 16 bars), the five presets and your own, zoom, *Centred on the points*, and a live seek for the record on air.
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

**Sets.** The set in the decks is `set: {name, steps, step}` on the deck, where `step` is the record on air. `setchain` replaces everything after the record on air with a chain (keeping the steps already played), and queues its first link; it's refused while a transition is under way, or if the chain doesn't start with the record on air. `setedit {steps, step, was}` replaces the whole list around the record on air without stopping it: `step` is where that record is in the new list and `was` is the step the editing screen saw, so an edit made from a stale view is turned down. It's also turned down if the record at `step` isn't the one on air, if its link is already past, or (during a transition) if the incoming record would change. Otherwise the next record is parked on the free deck with the new link queued, or a queued link with no next record is called off. When a set's transition finishes, any screen sends `setstep` (the house also checks before every deck command). The house then moves `step` on, puts the next record on the deck that's free, and queues the next transition as a timed one. Saved sets live on each device in `cg.party.sets`, and `setload` sends one to the house. Saved cues come back with their records.

**Song analysis** (`features/party/deck/analysis/`). Every record gets a waveform, tempo, beat grid, downbeat and a per-second energy curve:
- Recordings are fetched and decoded at 11 kHz mono in the background while the booth's console is open (the records on the decks first; the 72-minute set in 1.5 MB byte ranges). They play as usual meanwhile.
- `analyze.ts` finds the tempo from how onsets repeat (each candidate, its double and half tuned to the best-fitting grid, leaning toward DJ tempos). It finds the downbeat from where the record changes on a bar line, and calls the grid reliable only if it holds section by section.
- Results are kept in IndexedDB (`cg-dj`) under the record's id and its audio version (the file's ETag, or size and date, read from a one-byte range request, which also gives the full size). Replacing a file gets it analyzed again, and so does changing how it's done (`METHOD`). Built-in records are worked out from their patterns.
- A new recording needs nothing extra: put the file in `public/audio/dj/`, add it to `RECORDED_TRACKS` and `RECORDING_URLS`, and it is analyzed the first time the console opens.

**Suggestions** (`suggest.ts`) put the outgoing point on the record's 8-bar phrases:
- the next phrase;
- the biggest energy drop ahead (a breakdown);
- the outro.

The incoming record comes in on a downbeat, timed so its biggest energy lift (its drop) lands as the transition ends, or from your first saved cue for one of them. Both records play at the deck's speed, so their own tempos must match: the length is capped so they drift apart by no more than a third of a beat (bass swap or blend when they're close, echo or a cut when they're not). If either grid isn't reliable, the times are marked *Approximate* and the transition is a blend of about 8 to 16 seconds.

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
  - `party/definitions.ts`: the `deck`, `drop`, `mix`, `cue`, `drop-cue`, `transport`, `mark`, `mixnow`, `unmix`, `setload`, `setchain`, `setjump`, `setappend`, `setedit` and `setstep` commands (`mix` takes optional `at` and `inAt`), `PartyState.deck`.
  - `party/reducer.ts`: deck commands, loading and ejecting, jumping, transitions, taking turns, save and restore, holding when the house empties.
- **Client:**
  - `features/party/deck/`: engine (a three-band EQ and an echo send per deck, set every tick from the channel and the transition), tracks, recordings, console (`DjConsole.tsx`: booth and music-player pages, place bars, channel strips, transitions), lights page (`LightsPage.tsx`), styles.
  - `partyUi.ts`: the transition you've picked and your saved presets (`cg.party.mix` in local storage), and your saved sets (`cg.party.sets`).
  - `deck/workspace/`: the Workspace tab. `Workspace.tsx` (the pair, controls, status, suggestions, panels), `SetList.tsx` (rows, song picker, saved sets), `TrackLane.tsx` (a waveform lane on canvas), `setPlan.ts` (the list's edits and relinking, pure), `workspaceStore.ts` (the pair, draft, panel, review marks, status and `sendTracked`). `deck/preview.ts`: the private rehearsal engine and the duck. `deck/analysis/`: `analyze.ts` (listening), `trackAnalysis.ts` (the background queue and IndexedDB cache), `suggest.ts` (suggested transitions), `chain.ts` (working links out).
  - `MusicDock.tsx`: runs the engine and the spatial mix, moves a set on when its transition ends, and shows the console only while your sim works the gear.
  - `partyHooks.ts`: `useGearInUse`, `usePartyGear`, `useSlider`.
  - `tools/LiveTools.tsx`: the "Play some music" verb; the old "Light controls…" and "Music…" menu items are gone.
  - `render/pencil.ts` and `render/kit.ts`: the `push` option.
  - `render/party/*`: pulse uniforms, the equaliser and level-light materials, model changes.
- **Tests:**
  - `shared/__tests__/deck.test.ts`
  - `client/features/party/deck/deckTime.test.ts` (typed times)
  - `client/features/party/deck/deck.test.ts`
  - `client/features/party/deck/analysis/analyze.test.ts`, `suggest.test.ts` and `chain.test.ts`
  - `client/features/party/deck/workspace/setPlan.test.ts` (adding, moving and removing around the record on air)
  - the server wire test in `server/__tests__/party.test.ts`
