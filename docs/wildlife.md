# Wildlife

The countryside now has animals, on top of the butterflies, bird flocks, falling leaves, ripples and ducks that were already there (`Ambient`, `Waterbirds`). Everything is client-side scenery, like those: nothing is saved, sent to the server or clickable, and nothing touches the house, its navigation or the multiplayer state.

## Who lives where

| Animal | Where | What it does |
| --- | --- | --- |
| Doe with her fawn | meadow strip by the lake's east shore (a quiet clearing from `trailNetwork().open`) | wanders between grazing spots, head down, now and then looks up |
| Buck (antlers) | the quiet back lawn behind the hedge | the same |
| Rabbits ×3 | beside meadow bushes | hop to a nibbling spot, chew, sit up when watched |
| Squirrels ×2 | the leafy trees nearest the lot | scamper along the ground, up a trunk, sit on a branch, back down, on to the next tree |
| Fox | the longest footpath, a little to the side | trots along, stopping to sniff |
| Frogs ×3 | the lily pads | sit with a pulsing throat, hop to the next pad now and then |
| Sparrows ×5 | the fence posts | preen, fly to another post |
| Rabbit and hedgehog | the garden (inside the lot) | wander the bare lawn |
| Fish | the lake | leap now and then, leaving a ring |

## How it works (`render/wildlife/`)

- `wildlifeLayout.ts` (pure, tested): each animal is a loop of **beats** (walk to a spot, stay a while doing something) at a pace, offset by a phase. Where it is depends only on the clock (`patrolAt`), and the clock is `serverNow()`, so both players see the same animal in the same place. Outdoor routes come from the lot size alone (clearings, trails, trees, bushes, lilies, fence posts). **Garden animals** come from the house's own plan (`gardenCritters(blueprint)`): bare lawn only (no floor, roof or furniture), joined by A\* over a lawn-only nav grid and trimmed to straight runs that stay on the lawn, so they walk round the house, never through it. They are recomputed when the ground floor changes.
- `wildlifeModels.ts`: each species is a few parts (body, head, legs in two diagonal pairs, tail, wings) built with `Kit` and drawn as instanced meshes; `animate()` turns what an animal is doing (walking, grazing, sniffing, climbing, alert, fleeing) into small turns of its parts about their pivots.
- `Wildlife.tsx`: follows the schedule with a speed cap, so an animal that has been startled can run and then walk back to where the clock says it should be. It notices the characters on the ground floor: within an animal's skittish distance a wild animal bolts for the nearest tree (chosen so the run is over dry land and round the lot), a garden animal freezes and watches, and they drift back when you've gone. Animals further than 80 m from the camera aren't drawn; the whole thing is a few dozen instanced draw calls, no shadows, no raycasts.
- `prefers-reduced-motion`: the animals stand still at their first spot, and don't react.

A dev-only `window.__wild` exposes the critters and their live positions for poking at from the console.

## Not done

No sounds, no night animals (the scene has no day/night cycle), no clicking or feeding. Animals only react to characters on the ground floor.
