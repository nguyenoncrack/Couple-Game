# The Cozy Update: blanket forts

A fort for two, built from a small kit with the usual placement tools.

## The kit (Fort tab in the catalog)

| Item | Cost | Where it goes |
| --- | --- | --- |
| Blanket fort (3×2) | 450 | anywhere on a floor; two seats inside, a door at the front |
| Quilted fort mat (3×3) | 180 | snap point `mat`: under the fort and a step out of the door |
| Fort cushion | 60 | snap points `seat-left` / `seat-right`: one under each seat |
| Plush bear mascot | 90 | snap point `plush`: the back-left corner |
| Fort fairy lights | 120 | snap point `lights`: strung across the back |

**Snap points** are defined once in `packages/shared/src/fort/definitions.ts` (`ANCHORS`, in the frame's own frame, turned with the frame). A kit piece can only be placed on a free snap point of a fort on the same floor; the placement ghost snaps to the nearest one, and the server rejects anything else (`needs-fort`). The check runs once an edit (or batch) is done, so moving or turning a fort takes its pieces with it in one batch (`fortMoveOps`) and Undo puts them back in any order. Pieces use a new `decor` catalog layer (walkable, overlapping only other decor).

## Enter fort

`Enter fort` is the frame's `fort` action: two slots (left seat faces right, right seat faces left), so both players can be inside at once. Leaving is the usual `Stand` / any walk / any other activity, and a fort that is sold or moved lets its occupants go. First person sits at the posed head, so you look around from floor level.

## Shared settings

`LifeState.forts[frameId] = { name, sign, pattern, lit }` — optional in old saves, saved and restored with the house's life, broadcast to both players. Either player changes it with the `{do:"fort", id, cmd}` intent (`FortCmd`: any of `pattern`, `name`, `sign`, `lit`); the server checks the fort exists, tidies the text (control characters removed, one space between words, 28 / 48 characters), and refuses lights (`no-lights`) unless fairy lights are hung on that fort. Lights go out by themselves if they are taken down. Settings of a sold fort are kept for Undo (the last 8).

Three blanket patterns: Strawberry gingham, Starry night, Patchwork quilt (painted on small canvases, nothing to download).

## Look

The blanket is drawn live (`render/fort/FortDress.tsx`) inside the frame's own group: a cloth shader with the pattern, a warm amber glow from the inside when lit (strongest on the inside face), see-through while someone is in so they can be seen (solid again from inside in first person). The name sits on a plaque over the door; the sign is a handwritten note pinned beside it (Patrick Hand on a canvas). Fairy lights are glowing halos with a slow, shallow shimmer (steady with `prefers-reduced-motion`). No real lights and no shadows.

## Not in this release

One fort shape only; the blanket pattern is per fort, not per piece; the kit pieces can't be used outside a fort.
