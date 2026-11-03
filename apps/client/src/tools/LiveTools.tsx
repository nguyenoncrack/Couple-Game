import { actionsOf, catalog, slotsOf, tvFacing, type Action, type Level, type PlacedObject } from "@cg/shared";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cameraGestureActive } from "../render/CameraRig";
import { FLOOR_Y, Furniture, objectTransform, Walls } from "../render/House";
import { Roofs } from "../render/Roof";
import { act, openChat, sharePresence, useGame } from "../state/game";
import { together } from "../state/together";

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
  swim: "Swim",
  bathe: "Take a bath",
  toilet: "Use the toilet",
  wash: "Wash your hands",
};

/** Seats can be watched from too, when there's a TV in view. */
const seatSeesTv = (level: Level, o: PlacedObject) => slotsOf(o, "sit").some((s) => tvFacing(level, s));
const offers = (level: Level, o: PlacedObject): Action[] => [...new Set(actionsOf(o)), ...(seatSeesTv(level, o) ? (["watch"] as const) : [])];

/** Open what you can do with a piece of furniture, if anything. True if there's a menu. */
export function openObjectMenu(level: Level, id: string) {
  const o = level.objects[id];
  if (!o || !offers(level, o).length) return false;
  const { position, item } = objectTransform(o);
  const h = (item.model as { height?: unknown }).height;
  useGame.setState({ menu: { objectId: id, at: [position[0], typeof h === "number" ? h + 0.4 : 1.2, position[2]] } });
  return true;
}

export function LiveTools() {
  const view = useGame((s) => s.view);
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

  if (!view) return null;
  const level = view.levels[0]!;

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
    act({ do: "walk", x, z });
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
      <mesh geometry={plane} position={[0, 0.04, 0]} visible={false} onPointerDown={walk} />
      <Walls level={level} hiddenOpening={null} onOpeningDown={(_, e) => walk(e)} />
      <Furniture objects={level.objects} hidden={null} onObjectDown={onObjectDown} />
      <Roofs roofs={level.roofs} onDown={onRoofDown} />
      {tap && <TapMarker key={tap.at} x={tap.x} z={tap.z} />}
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
  const level = useGame((s) => s.view?.levels[0]);
  const life = useGame((s) => s.life);
  const me = useGame((s) => s.me);
  const members = useGame((s) => s.members);
  if (!menu || !level || !life || !me) return null;
  const us = together({ life, members, me });
  const mine = life.avatars[me];
  const options: { label: string; run: () => void }[] = [];
  let title = "";
  let body = "";

  if (menu.objectId) {
    const o = level.objects[menu.objectId];
    if (!o) return null;
    title = catalog.furniture.get(o.catalogId)?.name ?? "";
    const using = mine?.use?.objectId === o.id && !mine.use.station;
    const out = mine?.use?.action === "bathe" || mine?.use?.action === "swim";
    const playing = mine?.use?.action === "play" && (mine.use.consoleId === o.id || mine.use.tv === o.id || using);
    if (playing) options.push({ label: "Stop playing", run: () => act({ do: "stop" }) });
    else if (using) options.push({ label: out ? "Get out" : "Get up", run: () => act({ do: "stop" }) });
    // watching this TV from a seat across the room
    else if (mine?.use?.tv === o.id) options.push({ label: "Stop watching", run: () => act({ do: "stop" }) });
    if (us.inBed && us.here && mine?.use?.objectId === o.id)
      options.push(
        us.cuddling
          ? { label: "Stop cuddling", run: () => act({ do: "social", action: "uncuddle" }) }
          : { label: "Cuddle up ♥", run: () => act({ do: "social", action: "cuddle" }) },
      );
    for (const action of offers(level, o)) {
      if (action === "cook" || action === "prep") {
        if (life.cooking) {
          const name = catalog.recipes.get(life.cooking.recipeId)?.name ?? "the meal";
          if (!mine?.use?.station)
            options.push({
              label: `Help make ${name.toLowerCase()}`,
              run: () => act({ do: "help" }),
            });
        } else
          for (const r of catalog.recipes.values())
            options.push({
              label: `Make ${r.name.toLowerCase()}`,
              run: () => act({ do: "cook", recipeId: r.id, objectId: o.id }),
            });
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
    if (!who.online) {
      body = `${who.name} is away right now. Leave them a message?`;
    } else if (us.inBed)
      options.push(
        us.cuddling
          ? { label: "Stop cuddling", run: () => act({ do: "social", action: "uncuddle" }) }
          : { label: "Cuddle up ♥", run: () => act({ do: "social", action: "cuddle" }) },
      );
    else {
      options.push({ label: "Hug", run: () => act({ do: "social", action: "hug" }) });
      options.push({ label: "Kiss ♥", run: () => act({ do: "social", action: "kiss" }) });
    }
    options.push({
      label: "Say something…",
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
  }

  return (
    <Html position={menu.at} center zIndexRange={[30, 20]}>
      <div className="card live-menu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="kicker">{title}</div>
        {body && <p className="hand">{body}</p>}
        {options.length ? (
          options.map((o) => (
            <button key={o.label} className="btn" onClick={o.run}>
              {o.label}
            </button>
          ))
        ) : (
          <p className="hand">Nothing to do here right now.</p>
        )}
        <button className="close" onClick={() => useGame.setState({ menu: null })} aria-label="Close">
          ×
        </button>
      </div>
    </Html>
  );
}
