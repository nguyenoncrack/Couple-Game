# Home for Two (working title)

A cozy 3D house-building game for couples. Two people join the same house from their own devices with a link or
a private room code, then build and decorate it together in real time, and live in it: walk around, sit, sleep,
cook a meal together and eat it at the table. It's drawn in pencil, in the style of the Museum of Nguyen.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173, make an account (a name and a password) and make a house (start from the starter house
or an empty lot). Then open the invite link in another browser (or another device on the same network), make a
second account and you're in as the second player. Data is saved to `data/game.sqlite`.

```bash
npm test          # building and life rules + two-player server tests
npm run typecheck
npm run build && npm start   # production: the server also serves the built client on :8787
npm run dev:cloudflare       # the Cloudflare version, locally (wrangler dev on :8787; stop `npm run dev` first)
```

## Put it online (free, on Cloudflare)

The game runs on Cloudflare's free plan: a Worker serves the website and the API, and Durable Objects (with their own
SQLite) keep accounts and houses. You need a free Cloudflare account; no credit card.

```bash
npx wrangler login      # opens the browser once to connect your Cloudflare account
npm run deploy          # builds the website and uploads everything
```

It prints the address, like `https://home-for-two.<your-name>.workers.dev`. Send that to your partner. Run
`npm run deploy` again after any change; houses and accounts stay. `npx wrangler tail` shows the live logs.

What the free plan allows (per day): 100,000 requests (every 20 WebSocket messages count as one) and 13,000 GB-s
of Durable Object time, which is roughly 28 hours of a house being open. That's plenty for a handful of couples.
To stay inside it, a house lets everyone go after 30 minutes with nobody doing anything ("the house is napping",
one click to come back), and a tab that's been hidden for 5 minutes lets go until you look at it again.

Passwords are hashed with 50,000 PBKDF2 rounds on Cloudflare (100,000 on Node) so that signing in stays inside the
free plan's 10 ms of CPU per request. On the $5 paid plan you can raise `PASSWORD_ROUNDS` in
`apps/worker/wrangler.jsonc` to 100000 (the most Workers allow); existing passwords keep working either way. If
signing in ever fails with "error 1102", lower it instead.

## Controls

- **Camera:** right-drag or Option + drag to orbit. Space + drag, Shift + right-drag or W A S D to pan. Scroll to
  zoom, Q / E to turn a quarter, H for the whole lot. While you drag something, the view follows the pointer to the
  screen edge. The buttons on the right do the same.
- **Tools:** 1 select, 2 walls, 3 erase walls, 4 floor, 5 lift floor, 6 buy (furniture, outdoor items, doors and
  windows). T switches walls between up, cutaway and down.
- **Editing:** R rotates furniture or flips a door or window, Delete removes, Esc lets go. Doors and windows snap into
  the nearest wall. ⌘Z / Ctrl+Z undoes your own edits, ⇧⌘Z / Ctrl+Y redoes.
- **Living:** L (or the Build / Live switch) changes mode. In Live mode, click the floor to walk there, and click a
  sofa, chair, bed, lounger, counter, stove or plate for what you can do with it. Start a recipe at a counter or
  stove; your partner can lend a hand from the cooking card, which makes it faster. The meal is served on the
  nearest table. F keeps the camera on you, X stands still.

## How it fits together

```
packages/shared   pure TypeScript, no rendering or networking
  grid.ts         the 1 m grid; walls live on unit edges ("h:x:z", "v:x:z")
  blueprint.ts    the house: walls, floor tiles, objects, doors and windows, all keyed by stable IDs
  ops.ts          every change is a small op (walls.add, floor.paint, object.move, opening.place, …) or a batch
  rules.ts        applyOp(blueprint, op): the building rules, run by server and client alike
  undo.ts         inverseOp: the op that reverses another; undoCheck: has anything it touched changed since?
  starter.ts      the starter house template as one batch op
  life/           living in the house: nav.ts (walkable cells, A*), interactions.ts (furniture slots placed on the
                  lot), state.ts (characters, cooking, plates; positions from path + start time), engine.ts (the rules)
  catalog/        furniture.json, openings.json, pieces.json, recipes.json, starter.json, checked when loaded
  protocol.ts     WebSocket messages
apps/server       Node + ws + SQLite (node:sqlite); everything but app.ts, index.ts and node-sqlite.ts also runs on Cloudflare
  auth/           password and token hashing (Web Crypto), the sign-in cookie
  http/api.ts     accounts and sign-in, your houses, make one, join with a code, leave (fetch-style Request → Response)
  rooms/          one HouseRoom per active house; ops are applied one at a time; life wakes up only when something's due
  persistence/    Directory (accounts, houses, members) and HouseStore (snapshot + append-only op log + life), over SQL
apps/worker       Cloudflare: the Worker, a directory Durable Object and one Durable Object per house
apps/client       Vite + React + react-three-fiber
  net/            the API, WebSocket with reconnect and napping
  state/          confirmed house + my pending edits = what I see
  render/         pencil shaders, the kit model builder, furniture models, walls, floors, lot, characters, food
  tools/          build-mode pointer handling and previews; live-mode clicks and the interaction menu
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
- **Accounts.** A name and a password; names are unique however they're capitalised. Signing in sets an HttpOnly
  cookie; only hashes of passwords (PBKDF2) and sign-in tokens are stored. Changing your password signs you out
  everywhere else. Houses a browser joined before accounts move to whichever account signs in there first.
- **Membership.** At most two members per house. The WebSocket only accepts pages from the game's own address, and
  sign-ins, sign-ups, joins and connections are rate-limited. When the last person leaves a house, it's deleted.
- **Living together.** Characters, the meal on the go and plates on the table are life state, separate from the
  blueprint: no ops, no undo. The server owns it and sends all of it whenever it changes. A walk is sent as its path
  and start time on the server clock, so both screens work out where a character is every frame without more
  messages. Paths avoid walls, windows and furniture and go through doors. Furniture says where you stand to use it
  and where you end up (`interactions` in furniture.json); one person to a seat.
- **Cooking.** Recipes are steps at a counter or stove. A step only moves on while someone is working at its station,
  and each extra person in the kitchen speeds it up by half. When a step is done and nobody's at the next station,
  the cook goes over. Someone who disconnects stops working, so a meal they were making waits for them.
- **When the house changes under you.** Anyone using furniture that's moved or removed stands up, walks re-route
  around new furniture (or stop), furniture put down on someone moves them aside, and plates go with their table.
- **Saving life.** Life is saved to its own table a couple of seconds after changes and when a house unloads. After a
  restart everyone is where they settled, and a meal on the go is paused.
