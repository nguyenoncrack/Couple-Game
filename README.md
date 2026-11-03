# Home for Two (working title)

A cozy 3D house-building game for couples. Two people join the same house from their own devices with a link or
a private room code, then build and decorate it together in real time. It's drawn in pencil, in the style of
the Museum of Nguyen.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and make a house (start from the starter house or an empty lot), then open the invite link in another browser (or another device on
the same network) to join as the second player. Data is saved to `data/game.sqlite`.

```bash
npm test          # building rules + two-player server tests
npm run typecheck
npm run build && npm start   # production: the server also serves the built client on :8787
```

## Controls

- **Camera:** right-drag or Option + drag to orbit. Space + drag, Shift + right-drag or W A S D to pan. Scroll to
  zoom, Q / E to turn a quarter, H for the whole lot. While you drag something, the view follows the pointer to the
  screen edge. The buttons on the right do the same.
- **Tools:** 1 select, 2 walls, 3 erase walls, 4 floor, 5 lift floor, 6 buy (furniture, outdoor items, doors and
  windows). T switches walls between up, cutaway and down.
- **Editing:** R rotates furniture or flips a door or window, Delete removes, Esc lets go. Doors and windows snap into
  the nearest wall. ⌘Z / Ctrl+Z undoes your own edits, ⇧⌘Z / Ctrl+Y redoes.

## How it fits together

```
packages/shared   pure TypeScript, no rendering or networking
  grid.ts         the 1 m grid; walls live on unit edges ("h:x:z", "v:x:z")
  blueprint.ts    the house: walls, floor tiles, objects, doors and windows, all keyed by stable IDs
  ops.ts          every change is a small op (walls.add, floor.paint, object.move, opening.place, …) or a batch
  rules.ts        applyOp(blueprint, op): the building rules, run by server and client alike
  undo.ts         inverseOp: the op that reverses another; undoCheck: has anything it touched changed since?
  starter.ts      the starter house template as one batch op
  catalog/        furniture.json, openings.json, pieces.json, recipes.json, starter.json, checked when loaded
  protocol.ts     WebSocket messages
apps/server       Node + ws + SQLite (node:sqlite)
  http/           create a house, join with a code
  rooms/          one HouseRoom per active house; ops are applied one at a time
  persistence/    Store interface + SQLite version (snapshot + append-only op log)
apps/client       Vite + React + react-three-fiber
  net/            WebSocket with reconnect, saved houses
  state/          confirmed house + my pending edits = what I see
  render/         pencil shaders, the kit model builder, furniture models, walls, floors, lot
  tools/          build-mode pointer handling and previews
  ui/             HUD in the paper-and-ink style
```

- **The server decides.** A house's room checks each op against the latest blueprint, writes it to the op log, and only then
  sends it to both players with the next version number. An op the server rejects is undone on the client that made it.
- **Edits show up right away.** The client applies your op at once and keeps it pending until the server confirms it. When anything is
  confirmed, pending ops are replayed on top. If your partner changed something first, your op is dropped with a note.
- **When you both act at once.** Unit wall edges and per-cell floors make most simultaneous edits independent. Dragging or
  selecting an object, door or window puts a hold on it, so your partner can't change it at the same moment (not even by
  knocking down the wall a held door is in).
- **Undo.** Undo sends the inverse of your edit as an ordinary op, so your partner sees it too. If they've changed
  what you're undoing since, the undo is refused instead of overwriting their work. The starter house is one batch,
  so one undo removes it.
- **Disconnects.** The client reconnects with backoff, gets only the ops it missed (or a snapshot), and resends anything
  still pending. The server ignores ops it has already applied.
- **Saving.** Every accepted op is on disk before it's broadcast. Snapshots are written every 100 ops and when a house
  unloads. After a crash the op log rebuilds the house.
- **Many houses.** Rooms load when someone joins and unload when the house is empty. They share nothing.
- **Membership.** At most two members per house. Tokens are stored only as hashes, and join attempts are rate-limited.
