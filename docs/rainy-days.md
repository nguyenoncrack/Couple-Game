# Rainy Days

The "Rainy Days" update: a shared day and night, rain, a cozy Build catalog, and watching the rain together.

## The day (`packages/shared/src/world`, `render/Sky.tsx`, `render/skyModel.ts`)

- One day is **ten real minutes**: five of daylight (sunrise and sunset included, so the sun is up for phases 0 to 0.5) and five of night.
- The phase is a pure function of the **server clock** plus a saved `dayShift`: `dayPhase(serverNow(), world)`. Both screens agree, and a refresh or reconnect never resets it, because nothing about the day is stored except the shift a dev jump makes.
- The top-bar clock shows the game's time (sunrise reads 6:00 AM, noon 12:00 PM, sunset 6:00 PM, midnight 12:00 AM); the date beside it is still your device's, because the daily streaks count real days.
- The pencil shader's sun, sky fill and ground bounce are now uniforms (`lighting` in `pencil.ts`). `Sky` moves them each frame, with the moon at night, shadows following the light, a cool tint after dark, golden hour at either end of the day, and haze and sky dome colours to match. Up to eight lamps near the view light warm pools; lampshades and window panes glow. Previews and thumbnails are always drawn in plain daylight (`withDaylight`).

## Rain (`world/weather.ts`, `world/shelter.ts`, `render/weather/*`)

- Weather runs in four-minute spells, about half of them rainy (70 to 190 seconds, easing in and out over 12 s), at any hour. It is also a function of the server clock, independent of the day.
- Rain can be forced on or off (`WorldCmd` `weather`, eased over 6 s from whatever it was) or handed back to the natural pattern. The house stores only that forced setting.
- Rain is drawn as GPU-animated streaks. A **shelter map** from the house (roofs, upper floors, rooms shut in by walls) hides streaks below whatever covers them, so hiding the roof in cutaway mode never lets rain in.
- Puddles with ripples gather on footpaths and on paved cells you lay, and dry out over about 90 s. The sky goes overcast, light softens, the ground darkens.
- Rain audio is filtered noise in the ambience layer (so it follows the Sound switch, and the phone's Rain switch turns it and the falling rain off just for you): low and quiet indoors, bright and loud outside, judged from your character (Live) or where the camera looks (Build).
- Dev controls (`ui/DevWorld.tsx`, development builds only) jump to sunrise, noon, sunset or midnight and force rain, clear or auto. The server accepts the `world` intent from any member; only the buttons are dev-only.

## Cozy Build catalog

Cedar plank walls, framed frosted glass (a wall, and one and two-wide windows), rain slate flagstones, and a **Cozy** tab: patterned rug, window bench (two seats), reading lamp, blanket basket, umbrella stand and tea set for two. Data lives in `catalog/cozy.json`, `materials/cozy.json` and `catalog/openings.json`; models in `render/cozy/cozyModels.ts`. Older homes are unaffected: new items are just catalog ids.

## Watch the Rain (`life/rainwatch.ts`, `Life.rain`)

- A **window bench** (`windowSeat`) with a window in the wall its sitters face. In Live mode its menu offers **Watch the rain** and **Ask {partner} to watch with you ♥**, only while it rains and there's a window behind it.
- The invitation is the same kind of thing as a hug: the partner walks over to the other seat (and is told by a toast). If the partner can't get there, there's no seat for them, or they're busy cooking, eating or asleep, nobody moves.
- Two people on one bench while it rains are doing `rain` (sitting, with a small Social boost); when the rain stops or one gets up, it's plain sitting again. Either can stand up at any time. The server wakes itself up when the rain next changes, and the pair is recomputed after reloads from the saved house.
