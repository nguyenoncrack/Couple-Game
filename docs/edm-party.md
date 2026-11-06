# EDM / house party

Branch: `feature/edm-party` (from main `c136f18`). Nothing is merged, pushed or deployed until approved.

A "Party" category of furniture, a compact party panel, dancing, and a shared YouTube music queue.

## What's in it

**Items** (category `party`, each with two more finishes, search terms and a thumbnail drawn from its own model)

| Item | Footprint | What it does |
| --- | --- | --- |
| Dance floor tile / panel | 1×1 / 2×2, rug layer | Lit glass tops painted from where they stand in the house, so any layout lines up. Dance on them. |
| DJ booth | 3×1 | Lit front, two decks with turning records, mixer, laptop. Three places to work it (two behind, one in front). |
| Laser light | 1×1 | A seven-beam fan that rocks gently; the panel's *Laser spread* opens it wider. |
| Moving-head lights | 1×1 | Two heads that pan and tip, each with a beam and a pool of light on the floor. |
| LED wall strips | 2×1, rug layer | Five tall bars of light for a wall; the palette flows up them. |
| Mirror disco ball | 1×1 | Turns slowly; spots of light circle the room. |
| Party speaker | 1×1 | Lit ring round the woofer; glows brighter while music plays. |
| Music player | 1×1 | A rounded cabinet; it and the DJ booth are what allow a music queue. |

**Dancing**: five loops (Bounce, Sway, Disco point, Hands up, Shuffle), in place or on a dance tile, from the panel or the tile's menu. The DJ booth is its own activity. Both are ordinary activities, so starting anything else (or walking) ends them, and they end the stove, sink, seat or toilet like any other order.

**Lights**: on/off, brightness, presets (Sunset, Neon, Chill, Aurora), one colour, Steady light, laser spread. One shared state for the house, kept with life state and saved with it. Patterns are slow drifts (no preset is quicker than 10 s a cycle), a change of preset dips and returns, steady holds everything still, and a device that asks for reduced motion is held steady. Lights follow a schedule on the server clock; they do **not** react to the sound.

**Music**: paste a YouTube link (watch, youtu.be, embed, shorts, live, music.youtube.com; a `t=` start is honoured; playlists and channels are refused). Either player can add, play now, pause, seek ±10 s, skip and remove. Each screen plays it in YouTube's own embedded player (IFrame API), kept in step with the shared state; volume and mute are per player (this device). The sound comes from the speakers: the player's volume is scaled by how far that player's character stands from the nearest speaker, DJ booth or music player (full within 2 m, about a third at 6 m, never below 5%, and a floor up or down counts as 7 m more). YouTube's player only exposes a volume, so there is no left/right panning; a "Fade" switch in the music dock turns the fading off.

## How it's built

- `packages/shared/src/party/`: definitions (presets, dances, command schema), the reducer the server applies, link parsing. New LifeIntents `dance` and `party`; new actions `groove`, `dj`. `LifeState.party` holds lights and music; it is optional, so older homes load unchanged.
- Server (`house-room.ts`): `party` commands aren't orders to a character; they're rate-limited, checked against the house (lights need lighting gear or a dance floor, music needs a music player or DJ booth), schema-checked, capped at 20 videos, and idempotent (two screens both reporting "ended" skips once). The music holds where it is when the house empties.
- Client `render/party/`: shared shader materials (`partyMaterials`), models (`partyModels`), light maths (`partyLayout`, pure and tested), the live beams (`PartyLights`, instanced, no real lights, no shadows, counts capped). `features/party/`: panel, dock, YouTube loader, the pure sync planner (`musicPlan`) and the controller.
- Beams, spots and lasers stop at the room's walls (a door counts as wall), at the lot edge, and upstairs at the edge of the floor.

## YouTube: what the official docs required, and what it means here

Checked against the IFrame Player API reference and the Required Minimum Functionality / Developer Policies pages.

- The player is YouTube's own, at least 200 px on each side with its controls fully visible, and nothing is drawn over it (our controls sit under it).
- Nothing plays from a hidden player: the player exists only while this screen has joined the music and something is queued; *Leave* takes it down. Leaving the house takes it down.
- No audio is extracted, saved or separated, and no titles or media are stored: the house keeps video IDs only. Thumbnails are YouTube's own images.
- Joining is a click (*Enable music*), which is also what browsers want for sound.
- The `Referer` is not suppressed.

## Playback limitations

- **Sound needs a click in some browsers.** If the browser refuses sound, the player carries on **muted** (always allowed), the panel says so, and *Enable music* (or the speaker on the video) brings the sound in. Some embedded browsers (the in-app browser used for testing) won't let a script unmute even after a click on the page; there the speaker on the video itself is the way.
- A video the owner doesn't allow embedded (errors 101/150), removed or private (100) is skipped for everyone, with a note.
- Position is kept within about a second or two of the shared clock; a player that falls 2.5 s behind is moved.
- Pausing, playing or dragging the player's own bar counts for the house.
- Lights are scheduled, not audio-reactive.
- Autoplaying the next video in the queue rides on the click that joined the music.

## Shared files touched

`catalog/index.ts` (category, `party` field, party.json, actions), `life/state.ts` (`Use.move`, `LifeState.party`), `life/engine.ts` (dance, party, save/restore), `life/needs.ts`, `life/autonomy.ts`, `protocol.ts`, `house-room.ts`, `render/models.ts` (registers builders, ghost flag), `render/House.tsx` (live parts), `render/Scene.tsx`, `render/Characters.tsx`, `tools/LiveTools.tsx`, `ui/Hud.tsx`, `state/game.ts`, `state/music.ts` (lo-fi music steps aside while party music plays).
