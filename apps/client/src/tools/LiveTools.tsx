import { actionsOf, catalog, DANCES, floorOf, isLift, liftStops, positionAt, slotsOf, snapUnder, tvFacing, type Action, type Level, type Leftover, type PlacedObject, type Recipe, STOREY, type Together } from "@cg/shared";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cameraGestureActive } from "../render/CameraRig";
import { FLOOR_Y, Furniture, objectTransform, Walls } from "../render/House";
import { Roofs } from "../render/Roof";
import { openRoofs } from "../render/Storeys";
import { openFort } from "../features/fort/fortUi";
import { openParty } from "../features/party/partyUi";
import { act, fortCmd, openChat, serverNow, sharePresence, useGame } from "../state/game";
import { together } from "../state/together";
import { floorName } from "../ui/FloorPicker";

/**
 * Pointer handling in Live mode: click the floor to walk there, click furniture or a plate for what you can do
 * with it. The house can't be changed from here, so nothing is held or dragged.
 */

const VERB: Record<Action, string> = {
  sit: "Sit",
  sleep: "Sleep",
  lounge: "Lounge",
  cook: "Cook",
  prep: "Cook",
  watch: "Watch TV",
  play: "Play PS5",
  pingpong: "Play ping-pong",
  blackjack: "Play blackjack",
  swim: "Swim",
  bathe: "Take a bath",
  shower: "Take a shower",
  toilet: "Use the toilet",
  wash: "Wash your hands",
  groove: "Dance",
  dj: "Work the decks",
  fort: "Enter fort",
};

/** What an item does for a party (see party/definitions.ts). */
const partyRoles = (o: PlacedObject) => catalog.furniture.get(o.catalogId)?.party ?? [];
/** The blanket fort a piece belongs to: the frame itself, or the frame a kit piece snaps onto. */
function fortFrameOf(level: Level, o: PlacedObject): PlacedObject | null {
  const role = catalog.furniture.get(o.catalogId)?.fort;
  if (!role) return null;
  return role === "frame" ? o : (snapUnder(level, role, o, catalog)?.frame ?? null);
}
const isFridge = (o: PlacedObject) => Boolean(catalog.furniture.get(o.catalogId)?.fridge);
const liftIs = (o: PlacedObject) => isLift(catalog.furniture.get(o.catalogId));

/** Seats can be watched from too, when there's a TV in view. */
const seatSeesTv = (level: Level, o: PlacedObject) => slotsOf(o, "sit").some((s) => tvFacing(level, s));
const offers = (level: Level, o: PlacedObject): Action[] => [...new Set(actionsOf(o)), ...(seatSeesTv(level, o) ? (["watch"] as const) : [])];

/** Open what you can do with a piece of furniture, if anything. True if there's a menu. */
export function openObjectMenu(level: Level, id: string) {
  const o = level.objects[id];
  if (!o || (!offers(level, o).length && !isFridge(o) && !liftIs(o) && !partyRoles(o).length && !fortFrameOf(level, o))) return false;
  const { position, item } = objectTransform(o);
  const h = (item.model as { height?: unknown }).height;
  const base = useGame.getState().floor * STOREY;
  useGame.setState({ menu: { objectId: id, at: [position[0], base + (typeof h === "number" ? h + 0.4 : 1.2), position[2]] } });
  return true;
}

/** Open what you can do with your partner, over wherever they are. */
export function openPartnerMenu() {
  const s = useGame.getState();
  const partner = s.members.find((m) => m.id !== s.me);
  const avatar = partner && s.life?.avatars[partner.id];
  if (!avatar) return;
  const p = positionAt(avatar, serverNow());
  useGame.setState({ menu: { memberId: partner.id, at: [p.x, p.y + 2.3, p.z] } });
}

/** Things to do with your partner, in the menu you get by clicking them. */
const WITH_PARTNER: { group: string; items: [Together, string][] }[] = [
  { group: "Sweet", items: [["hug", "Hug"], ["kiss", "Kiss ♥"], ["slowdance", "Slow dance"], ["backrub", "Back rub"]] },
  { group: "Fun", items: [["highfive", "High five"], ["dance", "Dance"], ["tickle", "Tickle"], ["joke", "Tell a joke"]] },
  { group: "Talk", items: [["talk", "Have a chat"]] },
];

export function LiveTools() {
  const view = useGame((s) => s.view);
  const floor = useGame((s) => s.floor);
  const plane = useMemo(() => new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), []);
  const [tap, setTap] = useState<{ x: number; z: number; at: number } | null>(null);

  // My partner sees no cursor from me while I'm living rather than building.
  useEffect(() => sharePresence({ cursor: null, tool: "live", drag: null }), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") useGame.setState({ menu: null });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const level = view?.levels[floor];
  if (!view || !level) return null;

  const walk = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || cameraGestureActive() || useGame.getState().firstPerson) return;
    const x = Math.floor(e.point.x);
    const z = Math.floor(e.point.z);
    if (x < 0 || z < 0 || x >= view.lot.w || z >= view.lot.d) return;
    if (useGame.getState().menu) {
      // the first click away just closes the menu
      useGame.setState({ menu: null });
      return;
    }
    setTap({ x: x + 0.5, z: z + 0.5, at: performance.now() });
    // to the floor you're looking at
    act({ do: "walk", x, z, level: useGame.getState().floor });
  };

  // A press on the roof means the room under it, not the ground somewhere past the house.
  const onRoofDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    walk(e);
  };

  const onObjectDown = (id: string, e: ThreeEvent<PointerEvent>) => {
    if (cameraGestureActive() || useGame.getState().firstPerson) return;
    if (!openObjectMenu(level, id)) walk(e);
  };

  return (
    <>
      <group position-y={floor * STOREY}>
        <mesh geometry={plane} position={[0, 0.04, 0]} visible={false} onPointerDown={walk} />
        <Walls level={level} base={floor * STOREY} hiddenOpening={null} onOpeningDown={(_, e) => walk(e)} />
        <Furniture objects={level.objects} hidden={null} onObjectDown={onObjectDown} />
        <Roofs roofs={openRoofs(view, floor)} onDown={onRoofDown} />
        {tap && <TapMarker key={tap.at} x={tap.x} z={tap.z} />}
      </group>
      <Menu />
    </>
  );
}

/** A ring where you clicked, shrinking away. */
function TapMarker({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const born = useRef(performance.now());
  const color = useGame((s) => s.members.find((m) => m.id === s.me)?.color ?? "#3a3631");
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = Math.min(1, (performance.now() - born.current) / 700);
    m.scale.setScalar(1 - t * 0.6);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    m.visible = t < 1;
  });
  return (
    <mesh ref={ref} position={[x, FLOOR_Y + 0.02, z]} rotation-x={-Math.PI / 2} raycast={() => null}>
      <ringGeometry args={[0.22, 0.32, 28]} />
      <meshBasicMaterial color={color} transparent depthWrite={false} />
    </mesh>
  );
}

/** What you can do with the thing you clicked. */
function Menu() {
  const menu = useGame((s) => s.menu);
  const view = useGame((s) => s.view);
  const life = useGame((s) => s.life);
  const me = useGame((s) => s.me);
  const members = useGame((s) => s.members);
  // the floor what you clicked is on (a lift is on the ground floor, whichever floor you click it from)
  const level = (menu?.objectId && view?.levels.find((l) => l.objects[menu.objectId!])) || view?.levels[0];
  if (!menu || !view || !level || !life || !me) return null;
  const us = together({ life, members, me });
  const mine = life.avatars[me];
  const options: { label: string; run: () => void; group?: string }[] = [];
  let title = "";
  let body = "";
  /** The stove or counter to start a meal at, when there's one to pick. */
  let cookAt: string | null = null;
  /** The fridge you opened. */
  let fridge: string | null = null;

  if (menu.objectId) {
    const o = level.objects[menu.objectId];
    if (!o) return null;
    title = catalog.furniture.get(o.catalogId)?.name ?? "";
    if (isFridge(o)) fridge = o.id;
    if (liftIs(o)) {
      // pick a floor: walk over, call it, ride
      const riding = mine?.use?.ride?.lift === o.id ? mine.use.ride : undefined;
      if (riding) body = riding.on ? `Going to the ${floorName(riding.to).toLowerCase()}.` : `Waiting for the lift to the ${floorName(riding.to).toLowerCase()}.`;
      const here = mine ? floorOf(mine) : 0;
      if (!riding?.on)
        for (const s of liftStops(view, o.id, catalog))
          if (s.level !== here) options.push({ group: "Go to", label: floorName(s.level), run: () => act({ do: "ride", objectId: o.id, level: s.level }) });
    }
    const using = mine?.use?.objectId === o.id && !mine.use.station;
    const out = mine?.use?.action === "bathe" || mine?.use?.action === "shower" || mine?.use?.action === "swim";
    const playing = mine?.use?.action === "play" && (mine.use.consoleId === o.id || mine.use.tv === o.id || using);
    if (playing) options.push({ label: "Stop playing", run: () => act({ do: "stop" }) });
    else if (using) options.push({ label: mine?.use?.action === "pingpong" || mine?.use?.action === "blackjack" ? "Leave table" : mine?.use?.action === "fort" ? "Leave fort" : out ? "Get out" : "Get up", run: () => act({ do: "stop" }) });
    // watching this TV from a seat across the room
    else if (mine?.use?.tv === o.id) options.push({ label: "Stop watching", run: () => act({ do: "stop" }) });
    if (us.inBed && us.here && mine?.use?.objectId === o.id)
      options.push(
        us.cuddling
          ? { label: "Stop cuddling", run: () => act({ do: "social", action: "uncuddle" }) }
          : { label: "Cuddle up ♥", run: () => act({ do: "social", action: "cuddle" }) },
      );
    // dance floors offer each dance; party gear opens the party panel
    if (offers(level, o).includes("groove"))
      for (const d of DANCES) options.push({ group: "Dance", label: d.name, run: () => act({ do: "dance", objectId: o.id, move: d.id }) });
    // blanket forts (and the pieces on them): lights, and the panel for the blanket, name and sign
    const frame = fortFrameOf(level, o);
    if (frame) {
      const fort = life.forts?.[frame.id];
      options.push({ group: "Fort", label: fort?.lit ? "Fairy lights off" : "Fairy lights on", run: () => { useGame.setState({ menu: null }); fortCmd(frame.id, { lit: !fort?.lit }); } });
      options.push({ group: "Fort", label: "Blanket, name & sign…", run: () => { useGame.setState({ menu: null }); openFort(frame.id); } });
      if (fort?.name) title = fort.name;
    }
    const roles = partyRoles(o);
    if (roles.includes("lights") || roles.includes("dance")) options.push({ group: "Party", label: "Light controls…", run: () => { useGame.setState({ menu: null }); openParty("lights"); } });
    if (roles.includes("music")) options.push({ group: "Party", label: "Music…", run: () => { useGame.setState({ menu: null }); openParty("music"); } });
    for (const action of offers(level, o)) {
      if (action === "groove") continue;
      if (action === "cook" || action === "prep") {
        if (life.cooking) {
          const name = catalog.recipes.get(life.cooking.recipeId)?.name ?? "the meal";
          if (!mine?.use?.station)
            options.push({
              label: `Help make ${name.toLowerCase()}`,
              run: () => act({ do: "help" }),
            });
        } else cookAt = o.id;
      } else if (action === "play" ? !playing : action === "watch" ? mine?.use?.action !== "watch" || (mine.use.objectId !== o.id && mine.use.tv !== o.id) : !using)
        options.push({
          label: VERB[action],
          run: () => act({ do: "use", objectId: o.id, action }),
        });
    }
  } else if (menu.memberId) {
    const who = members.find((m) => m.id === menu.memberId);
    if (!who) return null;
    title = who.name;
    if (!who.online) body = `${who.name} is away, but they're still about the house.`;
    if (!us.here) body = `${who.name} is away right now. Leave them a message?`;
    else if (us.inBed)
      options.push(
        us.cuddling
          ? { label: "Stop cuddling", run: () => act({ do: "social", action: "uncuddle" }) }
          : { label: "Cuddle up ♥", run: () => act({ do: "social", action: "cuddle" }) },
      );
    else
      for (const { group, items } of WITH_PARTNER)
        for (const [action, label] of items) options.push({ group, label, run: () => act({ do: "social", action }) });
    options.push({
      group: us.here && !us.inBed ? "Talk" : undefined,
      label: who.online ? "Say something…" : "Leave a message…",
      run: () => {
        useGame.setState({ menu: null });
        openChat(true);
      },
    });
  } else if (menu.dishId) {
    const d = life.dishes.find((x) => x.id === menu.dishId);
    if (!d) return null;
    const r = catalog.recipes.get(d.recipeId);
    title = r?.name ?? "A plate";
    options.push({
      label: d.portions > 1 ? `Eat (${d.portions} servings left)` : "Eat the last serving",
      run: () => act({ do: "eat", dishId: d.id }),
    });
    if (view.levels.some((l) => Object.values(l.objects).some(isFridge))) options.push({ label: "Put in the fridge", run: () => act({ do: "store", dishId: d.id }) });
  }

  return (
    <Html position={menu.at} center zIndexRange={[30, 20]}>
      <div className="card live-menu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="kicker">{title}</div>
        {body && <p className="hand">{body}</p>}
        {cookAt && <RecipePicker objectId={cookAt} />}
        {fridge && <FridgeShelf objectId={fridge} leftovers={life.fridge ?? []} />}
        {options.length ? (
          groups(options).map(([group, list]) =>
            group ? (
              <section key={group} className="live-group" aria-label={group}>
                <div className="live-group-name">{group}</div>
                <div className="live-grid">
                  {list.map((o) => (
                    <button key={o.label} className="btn" onClick={o.run}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              list.map((o) => (
                <button key={o.label} className="btn" onClick={o.run}>
                  {o.label}
                </button>
              ))
            ),
          )
        ) : cookAt || fridge ? null : (
          <p className="hand">Nothing to do here right now.</p>
        )}
        <button className="close" onClick={() => useGame.setState({ menu: null })} aria-label="Close">
          ×
        </button>
      </div>
    </Html>
  );
}

/** Options in their groups, in order (the ungrouped ones as they come). */
function groups<T extends { group?: string }>(options: T[]): [string | undefined, T[]][] {
  const out: [string | undefined, T[]][] = [];
  for (const o of options) {
    const last = out.at(-1);
    const same = o.group ? out.find(([g]) => g === o.group) : last && !last[0] ? last : undefined;
    if (same) same[1].push(o);
    else out.push([o.group, [o]]);
  }
  return out;
}

/** What to cook: every recipe, narrowed down as you type (by name or what's in it). */
function RecipePicker({ objectId }: { objectId: string }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => [...catalog.recipes.values()].sort((a, b) => a.name.localeCompare(b.name)), []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = all.filter((r) => words.every((w) => r.name.toLowerCase().includes(w) || r.ingredients.some((i) => i.includes(w))));
  const cook = (r: Recipe) => act({ do: "cook", recipeId: r.id, objectId });
  return (
    <div className="recipe-picker">
      <input
        className="recipe-search"
        type="search"
        placeholder={`Search ${all.length} recipes…`}
        aria-label="Search recipes"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && found[0]) cook(found[0]);
        }}
      />
      <ul className="recipe-list" aria-label="Recipes">
        {found.map((r) => (
          <li key={r.id}>
            <button className="btn recipe" onClick={() => cook(r)}>
              <span className="recipe-name">{r.name}</span>
              <span className="recipe-meta">
                serves {r.serves} · {r.steps.reduce((t, s) => t + s.seconds, 0)}s
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!found.length && <p className="hand">No recipe like that.</p>}
    </div>
  );
}

/** What's in the fridge: eat something now, or put it out on the table to share. */
function FridgeShelf({ objectId, leftovers }: { objectId: string; leftovers: Leftover[] }) {
  if (!leftovers.length) return <p className="hand">Nothing in here yet. A plate left out for half an hour gets put away in here.</p>;
  return (
    <ul className="recipe-list fridge-list" aria-label="In the fridge">
      {[...leftovers].reverse().map((l) => (
        <li key={l.id} className="fridge-item">
          <span className="fridge-food">
            <span className="recipe-name">{catalog.recipes.get(l.recipeId)?.name ?? "Leftovers"}</span>
            <span className="recipe-meta">
              {l.portions} {l.portions === 1 ? "serving" : "servings"}
            </span>
          </span>
          <button className="btn" onClick={() => act({ do: "fridge", leftoverId: l.id, objectId, eat: true })}>
            Eat
          </button>
          <button className="btn" onClick={() => act({ do: "fridge", leftoverId: l.id, objectId, eat: false })} title="Put it out on the table">
            Take out
          </button>
        </li>
      ))}
    </ul>
  );
}
