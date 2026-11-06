# Furniture and material expansion

Branch: `feature/furniture-materials-expansion`. Base: `36a565d` on main. Commit locally for review; do not push, merge or deploy before approval.

Adds 18 separate furniture models, four wall finishes and four floor finishes. New pieces fill gaps rather than providing recolours of the existing range. Office is a new catalog category; previous item definitions and categories remain intact.

## Furniture

| Item | Category | Footprint | Coins | Behavior |
| --- | --- | --- | --- | --- |
| Pebble nesting tables | living | 2 × 1 | 280 | Decorative |
| Amber electric fireplace | living | 2 × 1 | 790 | Decorative |
| Woven folding divider | living | 2 × 1 | 340 | Decorative |
| Bouclé bedroom bench | bedroom | 2 × 1 | 390 | 2 sit slot(s) |
| Arched dressing vanity | bedroom | 2 × 1 | 620 | Decorative |
| Blanket ladder | bedroom | 1 × 1 | 125 | Decorative |
| Butcher-block kitchen island | kitchen | 2 × 1 | 740 | 2 prep slot(s); serves dishes |
| Brass serving trolley | kitchen | 1 × 1 | 260 | Decorative |
| Twin-basin vanity | bathroom | 2 × 1 | 860 | 2 wash slot(s) |
| Front-load laundry washer | bathroom | 1 × 1 | 540 | Decorative |
| Freestanding towel warmer | bathroom | 1 × 1 | 170 | Decorative |
| Ergonomic swivel chair | office | 1 × 1 | 360 | 1 sit slot(s) |
| Architect drafting table | office | 2 × 1 | 690 | Decorative |
| Starlight arcade cabinet | entertainment | 1 × 1 | 980 | Decorative |
| Tournament foosball table | entertainment | 2 × 1 | 820 | Decorative |
| Hi-fi vinyl listening console | entertainment | 2 × 1 | 760 | Decorative |
| Wicker egg chair | outdoor | 2 × 2 | 650 | 1 sit slot(s) |
| Garden potting station | outdoor | 2 × 1 | 420 | Decorative |

The arcade, foosball table, vinyl console, laundry washer and other decorative pieces do not advertise unsupported actions. Sit, prep and wash use existing interaction slots and server rules. The island supports two prep positions and a clear 0.9 m serving surface; the double vanity has two recessed basins and independent wash positions.

## Building materials

| Kind | Finish | Pattern / scale |
| --- | --- | --- |
| Wall | Botanical wallpaper | Sage leaves and coral buds on warm paper, repeating every 40 cm. |
| Wall | Teal painted wainscoting | Raised teal panels below a 1 m chair rail, with warm plaster above. |
| Wall | Walnut acoustic slats | Narrow 4 cm timber slats on a dark acoustic backing. |
| Wall | Whitewashed shiplap | Horizontal 16 cm boards with recessed joints and subtle whitewashed grain. |
| Floor | Confetti terrazzo | Polished ivory terrazzo with irregular coral, teal and ochre mineral chips. |
| Floor | Charcoal slate flagstones | Staggered 60 × 40 cm slate slabs, fine grout and natural cleft texture. |
| Floor | Hexagonal terracotta | Warm fired-clay hexagons, 26 cm across, with pale sand grout. |
| Floor | Cobalt encaustic tile | A blue-and-ochre geometric rosette in repeating 40 cm cement tiles. |

Patterns use the existing metre-space coordinates, so adjacent tiles and wall segments remain aligned and each floor gets the same physical scale. The existing swatch previews, segment/tile/room application and undo/redo tools work with the new IDs. No separate material tool or persistence format is introduced.

## Compatibility

- Old IDs, prices, footprints and model data are unchanged; tests compare both legacy furniture JSON files to the loaded catalog.
- No blueprint fields, schema version, database tables, operation formats, network messages, dependencies or deployment configuration change.
- New catalog data is appended in a separate file. Optional render metadata retains the existing fallbacks.
- Placement validates normal collision and floor rules. New furniture remains centered, floor-supported and inside its reserved footprint in all four rotations, including valid/invalid previews.
- Door/window openings, glass transparency, stair/lift voids, multi-floor isolation and the upstairs movement fix retain their existing tests and behavior.

## Validation

- `npm test`: 42 files / 627 tests pass.
- `npm run typecheck`: shared, server, client and worker pass.
- `npm run build`: passes; Vite still warns about the large character-parts chunk.
- Every new model was visually inspected from three angles. The WebGL audit rendered 648 furniture variants (18 models × 3 angles × 4 rotations × solid/valid/invalid preview), plus 84 material variants (28 existing/new finishes × 3 states): 732 renders, zero shader failures.
- Geometry tests cover all catalog pieces in four rotations, finite geometry, footprint bounds and floor contact. Targeted raycasts verify the three new seat types, both recessed sink bowls, and the island worktop height.
- Real two-player WebSocket integration tests place all 18 pieces, synchronize their IDs, undo/redo the batch, reserve separate bench and basin slots, apply all eight new material IDs, and reload the exact blueprint after server restart.
- A simulated meal is made at the island with two chefs, served on its worktop, and followed by timed hand-washing.
- In the local browser, Office thumbnails and cross-category search worked. A trolley purchase was placed, undone and redone with the correct coin balance. Upstairs room walls and floor were painted through the regular tools; independent SQLite log replay confirmed 12 upstairs wainscot edges and 8 cobalt tiles, with all 266 downstairs terrazzo tiles unchanged.
- Browser review also exposed an existing music fade exception (negative audio volume) from `state/music.ts`; this unrelated file is unchanged.

## Files and integration points

New feature files:

- `packages/shared/src/catalog/furniture-expansion.json`: the 18 item definitions, searchable tags, dimensions, prices and supported interactions.
- `apps/client/src/features/furnitureExpansion/models.ts`: model registry and reusable joinery/tubing/prop builders.
- `apps/client/src/features/furnitureExpansion/models.test.ts`: range, interaction alignment and detailed geometry checks.
- `packages/shared/src/materials/expansion.json`: eight material definitions.
- `apps/client/src/features/buildMaterials/expansionShader.ts`: the eight procedural finishes.
- `packages/shared/src/__tests__/furniture-expansion.test.ts`: placement, old data, materials, persistence round trips, undo, cooking and hand-washing.
- `apps/server/src/__tests__/furniture-expansion.test.ts`: multiplayer synchronization, shared seats/basins, undo and restart.
- `docs/furniture-materials-expansion.md`: this review guide.

Small edits in shared files:

| File | Integration change |
| --- | --- |
| `packages/shared/src/catalog/index.ts` | Append the separate furniture JSON and allow the Office category. |
| `packages/shared/src/materials/catalog.ts` | Append expansion definitions and extend the optional surface enum. |
| `apps/client/src/render/models.ts` | Import/spread the new builder registry. |
| `apps/client/src/ui/Hud.tsx` | Add the Office tab; clarify decorative entertainment pieces. |
| `apps/client/src/features/buildMaterials/material.ts` | Register eight shader profiles and their gloss parameters. |
| `apps/client/src/features/buildMaterials/surfaceShader.ts` | Include the extension shader cases and grout treatment. |
| `apps/client/src/ui/catalogSearch.test.ts` | Include the new double vanity in bathroom sink results. |
| `packages/shared/src/__tests__/build-materials.test.ts` | Keep the original-family check extensible when new finishes are added. |

Temporary review-page code and screenshots are outside the commit under `outputs/furniture-materials-expansion`. The interactive local review servers are stopped after verification.
