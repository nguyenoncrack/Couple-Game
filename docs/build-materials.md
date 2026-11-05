# Wall and floor materials

Branch: `feature/build-materials`. Based on `c591e05` (multiple floors, stairs and lifts). This branch is intended for review and integration with Claude's furniture changes; it has not been merged or deployed.

## Included

Wall families: plaster (cream, sage, blush, sky), oak panels, fired brick, limestone, glazed tile, concrete and framed clear glass. Floors: oak planks, dark walnut, herringbone parquet, ceramic tile (ivory and blue), marble, woven carpet, concrete, decking and retained stone pavers.

Analytic textures use metre-scale coordinates in each floor's frame. Splitting a wall run or painting adjacent tiles does not reset patterns. Glazing uses transparent double-sided panes with opaque frames clipped around existing door/window holes. Glass remains a collision wall. The existing sunlight, shadows and fog uniforms remain connected.

The wall/floor picker provides rendered previews, names, descriptions and three scopes:

- Draw walls / Lay tiles: existing drag-to-build behavior.
- Segment / Tile: repaint one existing surface.
- Room: click the floor inside an enclosed room to repaint its boundary walls or existing floor tiles. Doors and windows bound rooms; open exterior space is rejected.

All scopes use the selected floor. Repaint excludes missing tiles and stair/lift voids. Wall materials apply to both faces of an edge, matching the existing data model; per-face paint is outside this change. Room wall paint therefore also changes the other face of a shared partition.

## Persistence and synchronization

Homes still save only `walls[edge].style` and `tiles[cell].material`. Legacy IDs remain valid. There are no new blueprint fields, schema changes, SQL changes or migration steps. New render-only catalog fields `surface` and `description` are optional; custom legacy definitions fall back to their existing `finish`.

Material application uses existing `walls.add`, `floor.paint` and atomic `batch` operations, with the optional `existingOnly: true` guard. Missing flags retain the old drawing behavior. Server rules skip surfaces a partner removed before a delayed repaint arrives. Inverse generation preserves the guard and existing undo fingerprints handle intervening partner edits. Repaint does not change geometry, openings, funds or navigation.

Integrate the shared operation/rule/undo changes with the client feature in one release. An older server does not understand the repaint guard or the new catalog IDs.

## File ownership and merge points

New feature files:

- `packages/shared/src/materials/catalog.ts`: optional metadata and default-catalog extension.
- `packages/shared/src/materials/materials.json`: all building material definitions.
- `packages/shared/src/materials/rooms.ts`: enclosed-room targeting and repaint operations.
- `apps/client/src/features/buildMaterials/material.ts`: cached material profiles and legacy fallback.
- `apps/client/src/features/buildMaterials/surfaceShader.ts`: aligned procedural texture details.
- `apps/client/src/features/buildMaterials/wallGeometry.ts`: existing opaque wall builder plus framed glazing.
- `apps/client/src/features/buildMaterials/tools.tsx`: paint scopes, gesture handling and target overlays.
- `apps/client/src/features/buildMaterials/previews.ts`: cached rendered swatches.
- `apps/client/src/features/buildMaterials/MaterialPanel.tsx`: wall/floor picker.
- `apps/client/src/features/buildMaterials/materials.css`: picker styles.
- `apps/client/src/features/buildMaterials/material.test.ts`: material and opening geometry checks.
- `packages/shared/src/__tests__/build-materials.test.ts`: catalog, targeting, compatibility and undo checks.
- `apps/server/src/__tests__/build-materials.test.ts`: real two-player synchronization and restart checks.
- `docs/build-materials.md`: this integration guide.

Small shared-file integration points:

| File | Hook to preserve when merging |
| --- | --- |
| `packages/shared/src/catalog/index.ts` | Optional wall/floor metadata and `withBuildMaterials(piecesData)` on the default catalog. Furniture loading is unchanged. |
| `packages/shared/src/index.ts` | Export material catalog and room helpers. |
| `packages/shared/src/ops.ts` | Optional repaint-only flag on existing wall/floor operations. |
| `packages/shared/src/rules.ts` | Skip absent repaint targets; no geometry collision validation for wall restyling. |
| `packages/shared/src/undo.ts` | Invert existing repaint targets only; preserve the optional guard. |
| `apps/client/src/render/House.tsx` | Delegate `addWall`, use building materials for wall/floor meshes, optional wall-pointer callback. Wall meshes opt into raycasting only for material tools. Furniture rendering and opening animation are unchanged. |
| `apps/client/src/render/pencil.ts` | One comment marker `// @build-material-detail` before normal perturbation. Building shaders inject details here; base shader behavior is unchanged. Keep this marker if refactoring the shader. |
| `apps/client/src/tools/BuildTools.tsx` | Paint queue/finish/cancel hooks, selected-level wall hit callback and paint preview. |
| `apps/client/src/ui/Hud.tsx` | Replace only the wall/floor picker branches with `MaterialPanel`. Buy/furniture UI is unchanged. |

Furniture catalogs, furniture models, recipes, starter homes, server persistence adapters, deployment configuration and package dependencies are untouched.

## Validation

Final checks: `npm test` passed all 35 files / 385 tests; `npm run typecheck` passed shared, server, client and worker; `npm run build` passed. Tests require local sockets (the sandbox blocks server `listen` otherwise). The production build reports a large character-parts chunk warning; no character code or dependencies are changed here.

Automated checks cover every requested family, legacy catalog IDs, selected-floor room boundaries, openings, stair/lift rotations, unchanged collision/navigation, individual tiles, room batches, undo/redo, conflict fingerprints, old-home loading and JSON round trips. The server test connects two actual WebSocket clients, verifies material broadcasts and a concurrent removal/repaint race, then restarts the server and verifies saved state.

Local browser checks use an isolated two-storey test house, not the live service. They verify upstairs room glass, room parquet, one marble tile, one brick wall segment and undo/redo, with independent SQLite snapshot/log inspection confirming downstairs and all opening IDs stay unchanged. Glass and herringbone patterns were visually inspected. A temporary review scene rendered all 20 choices in solid, valid-preview and invalid-preview states (60 variants) without shader failures. Review-only source files are excluded from the commit.

The application is not deployed by this change. Browser evidence and local fixture scripts are stored outside the repository under `outputs/build-materials` in the task workspace.
