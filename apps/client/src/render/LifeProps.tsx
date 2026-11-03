import { activityAt, arrivalTime, catalog, faceDir, type Dish, type Level, type LifeState } from "@cg/shared";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useReducer, useRef } from "react";
import type * as THREE from "three";
import { serverNow, useGame } from "../state/game";
import type { Kit } from "./kit";
import { KitMesh } from "./KitMesh";
import { FLOOR_Y, objectTransform } from "./House";
import { pencilMaterial } from "./pencil";
import { ConsoleScreen } from "./ConsoleScreen";
import { TableGameProps } from "./TableGameProps";

/**
 * Food and kitchenware: plates on the table, and the bowl, board, pan or pot in use while a meal is made. Also
 * the things furniture does while it's used: a TV that's on, bubbles in a bath, a running tap.
 */

const PORCELAIN = "#f6f2ea";
const METAL = "#a9a59d";

/** How high a surface's top is: the table's own height if it says, else a dining table's. */
function topOf(level: Level, surfaceId: string | null) {
  const o = surfaceId ? level.objects[surfaceId] : undefined;
  const item = o && catalog.furniture.get(o.catalogId);
  if (!item) return 0;
  const h = (item.model as { height?: unknown }).height;
  return typeof h === "number" ? h : 0.75;
}

function plate(k: Kit, recipeId: string, portions: number, serves: number) {
  k.add("cyl", pencilMaterial(PORCELAIN), [0, 0.01, 0], [0.3, 0.02, 0.3], {
    outline: 0.006,
  });
  const left = serves ? portions / serves : 1;
  if (recipeId === "pancakes") {
    const n = Math.max(1, Math.round(4 * left));
    for (let i = 0; i < n; i++)
      k.add("cyl", pencilMaterial("#e0aa5c"), [0, 0.035 + i * 0.026, 0], [0.2 - i * 0.008, 0.024, 0.2 - i * 0.008], { outline: 0.005, rot: [0, i * 0.7, 0] });
    k.box(pencilMaterial("#f6dc7a"), [0.01, 0.04 + n * 0.026, 0], [0.05, 0.02, 0.04], { outline: 0.004 });
  } else {
    const s = 0.5 + left * 0.5;
    k.add("half", pencilMaterial("#e8c77a"), [0, 0.02, 0], [0.2 * s, 0.1 * s, 0.2 * s], { outline: 0.005 });
    for (let i = 0; i < 4; i++)
      k.add("sphere", pencilMaterial("#c24b33"), [Math.cos(i * 1.6) * 0.04 * s, 0.055 * s + 0.02, Math.sin(i * 1.6) * 0.04 * s], 0.035 * s, { outline: 0.004 });
    k.add("sphere", pencilMaterial("#6f9a52"), [0.02, 0.09 * s + 0.02, 0], 0.025, { outline: false });
  }
}

function DishProp({ dish, level }: { dish: Dish; level: Level }) {
  const serves = catalog.recipes.get(dish.recipeId)?.serves ?? 1;
  const y = FLOOR_Y + topOf(level, dish.surfaceId);
  const open = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || useGame.getState().mode !== "live") return;
    e.stopPropagation();
    useGame.setState({
      menu: { dishId: dish.id, at: [dish.x, y + 0.3, dish.z] },
    });
  };
  return (
    <group position={[dish.x, y, dish.z]} onPointerDown={open}>
      {/* a bigger invisible target than the plate itself, so it's easy to click */}
      <mesh position={[0, 0.08, 0]} visible={false}>
        <cylinderGeometry args={[0.22, 0.22, 0.18, 10]} />
      </mesh>
      <KitMesh make={(k) => plate(k, dish.recipeId, dish.portions, serves)} deps={[dish.recipeId, dish.portions, serves]} />
    </group>
  );
}

/** What's on the worktop for each step of cooking. */
function kitchenware(k: Kit, what: string) {
  const metal = pencilMaterial(METAL, { finish: "stone" });
  const handle = pencilMaterial("#3d3833");
  switch (what) {
    case "mix":
      k.add("cone", pencilMaterial("#e7dccb"), [0, 0.07, 0], [0.32, 0.14, 0.32], { rot: [Math.PI, 0, 0], outline: 0.006 });
      k.add("cyl", pencilMaterial("#f2e4c4"), [0, 0.142, 0], [0.28, 0.01, 0.28], { outline: false });
      k.add("cyl", pencilMaterial("#b98a5a", { finish: "wood" }), [0.06, 0.2, 0], [0.025, 0.24, 0.025], { rot: [0, 0, -0.5] });
      break;
    case "chop":
      k.box(pencilMaterial("#c79a63", { finish: "wood" }), [0, 0.015, 0], [0.42, 0.03, 0.26], { outline: 0.006 });
      for (let i = 0; i < 3; i++) k.add("sphere", pencilMaterial("#c24b33"), [-0.1 + i * 0.07, 0.05, 0.03], 0.055, { outline: 0.004 });
      k.box(metal, [0.12, 0.04, -0.04], [0.16, 0.008, 0.04], {
        outline: 0.004,
      });
      break;
    case "fry":
      k.add("cyl", metal, [0, 0.03, 0], [0.32, 0.05, 0.32], { outline: 0.006 });
      k.add("cyl", pencilMaterial("#e0aa5c"), [0, 0.058, 0], [0.2, 0.012, 0.2], { outline: 0.004 });
      k.box(handle, [0.27, 0.05, 0], [0.24, 0.025, 0.04]);
      break;
    default:
      k.add("cyl", metal, [0, 0.11, 0], [0.32, 0.2, 0.32], { outline: 0.006 });
      k.add("cyl", pencilMaterial(what === "boil" ? "#cfe0e3" : "#c24b33"), [0, 0.2, 0], [0.28, 0.01, 0.28], { outline: false });
      for (const sx of [-1, 1]) k.box(handle, [sx * 0.19, 0.18, 0], [0.06, 0.03, 0.05]);
  }
}

function Steam() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.6 + i / 3) % 1;
      c.position.y = 0.15 + t * 0.45;
      c.position.x = Math.sin(t * 6 + i) * 0.04;
      c.scale.setScalar(0.05 + t * 0.07);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
    });
  });
  return (
    <group ref={ref}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} raycast={() => null}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color="#ffffff" transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Kitchenware on each station someone's working at, matching what the current step needs. */
function CookingProps({ level }: { level: Level }) {
  const life = useGame((s) => s.life);
  useArrivals(life);
  if (!life?.cooking) return null;
  const recipe = catalog.recipes.get(life.cooking.recipeId);
  if (!recipe) return null;
  const step = recipe.steps[life.cooking.step];
  const now = serverNow();
  return (
    <>
      {Object.values(life.avatars).map((a) => {
        const u = a.use;
        if (!u?.station || !u.objectId || activityAt(a, now) === "walk") return null;
        const o = level.objects[u.objectId];
        if (!o) return null;
        const { position, rotationY } = objectTransform(o);
        // the step being worked on at this kind of station, or the next one that will be
        const at = step?.station === u.station ? step : recipe.steps.find((s) => s.station === u.station);
        const what = at?.action ?? (u.station === "stove" ? "boil" : "chop");
        return (
          <group key={a.memberId} position={[position[0], position[1] + 0.91, position[2]]} rotation-y={rotationY}>
            <KitMesh make={(k) => kitchenware(k, what)} deps={[what]} />
            {u.station === "stove" && step?.station === "stove" && <Steam />}
          </group>
        );
      })}
    </>
  );
}

/** Draw again whenever someone gets where they were walking, since nothing arrives from the server then. */
function useArrivals(life: LifeState | null) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!life) return;
    const now = serverNow();
    const timers = Object.values(life.avatars)
      .map((a) => arrivalTime(a) - now)
      .filter((ms) => ms > 0)
      .map((ms) => window.setTimeout(redraw, ms + 30));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [life]);
}

/** Whoever's eating gets their own plate in front of them, served from the dish on the table. */
function Servings({ level }: { level: Level }) {
  const life = useGame((s) => s.life);
  useArrivals(life);
  if (!life) return null;
  const now = serverNow();
  return (
    <>
      {Object.values(life.avatars).map((a) => {
        const u = a.use;
        const dish = u?.action === "eat" ? life.dishes.find((d) => d.id === u.dishId) : undefined;
        if (!u || !dish || activityAt(a, now) === "walk") return null;
        const at = u.pose ?? { x: a.path[a.path.length - 1]![0], z: a.path[a.path.length - 1]![1], face: a.face };
        const [dx, dz] = faceDir(at.face);
        // a seated eater's plate sits on the table edge in front of them; standing ones hold theirs at the table
        const reach = u.pose ? 0.62 : 0.5;
        return (
          <group key={a.memberId} position={[at.x + dx * reach, FLOOR_Y + topOf(level, dish.surfaceId) + 0.005, at.z + dz * reach]} scale={0.8}>
            <KitMesh make={(k) => plate(k, dish.recipeId, 1, 2)} deps={[dish.recipeId]} />
          </group>
        );
      })}
    </>
  );
}

/** A TV that's on: the screen glows and flickers through a few soft colours. */
function Screen({ seed }: { seed: number }) {
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime + seed;
    const scene = Math.floor(t / 2.6);
    const hue = (0.52 + Math.sin(scene * 12.9898) * 0.18 + 1) % 1;
    m.color.setHSL(hue, 0.45, 0.62 + Math.sin(t * 7) * 0.03 + Math.sin(t * 2.3) * 0.04);
  });
  return (
    <mesh position={[0, 1.08, -0.204]} raycast={() => null}>
      <planeGeometry args={[1.28, 0.55]} />
      <meshBasicMaterial ref={ref} toneMapped={false} />
    </mesh>
  );
}

/** Bubbles drifting about on the bath water. */
function Bubbles() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      const t = clock.elapsedTime * 0.4 + i * 1.7;
      c.position.set(Math.sin(t + i) * 0.6, 0.5 + Math.abs(Math.sin(t * 2.1)) * 0.02, Math.cos(t * 0.8 + i * 2) * 0.22);
    });
  });
  return (
    <group ref={ref}>
      {[0.07, 0.05, 0.09, 0.06, 0.08, 0.05, 0.07].map((r, i) => (
        <mesh key={i} scale={[r, r * 0.6, r]} raycast={() => null}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** Water running from the tap into the basin. */
function Tap({ top, bottom }: { top: number; bottom: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (m) m.scale.x = m.scale.z = 1 + Math.sin(clock.elapsedTime * 30) * 0.15;
  });
  return (
    <mesh ref={ref} position={[0, (top + bottom) / 2, -0.25]} raycast={() => null}>
      <cylinderGeometry args={[0.012, 0.016, top - bottom, 8]} />
      <meshBasicMaterial color="#cfe6ee" transparent opacity={0.8} />
    </mesh>
  );
}

/** What furniture does while someone's settled in and using it. */
function InUse({ level }: { level: Level }) {
  const life = useGame((s) => s.life);
  useArrivals(life);
  if (!life) return null;
  const now = serverNow();
  const shown = new Map<string, "tv" | "game" | "bath" | "tap">();
  for (const a of Object.values(life.avatars)) {
    const u = a.use;
    if (!u || activityAt(a, now) !== u.action) continue;
    if (u.action === "watch" && u.tv && !shown.has(u.tv)) shown.set(u.tv, "tv");
    if (u.action === "play" && u.tv) shown.set(u.tv, "game");
    if (u.action === "bathe" && u.objectId) shown.set(u.objectId, "bath");
    if (u.action === "wash" && u.objectId) shown.set(u.objectId, "tap");
  }
  return (
    <>
      {[...shown].map(([id, what], i) => {
        const o = level.objects[id];
        if (!o) return null;
        const { position, rotationY } = objectTransform(o);
        const pedestal = (catalog.furniture.get(o.catalogId)?.model.kind ?? "") === "pedsink";
        return (
          <group key={id} position={position} rotation-y={rotationY}>
            {what === "tv" && <Screen seed={i * 3.1} />}
            {what === "game" && <ConsoleScreen />}
            {what === "bath" && <Bubbles />}
            {what === "tap" && (pedestal ? <Tap top={1.04} bottom={0.83} /> : <Tap top={1.06} bottom={0.77} />)}
          </group>
        );
      })}
    </>
  );
}

export function LifeProps() {
  const life = useGame((s) => s.life);
  const level = useGame((s) => s.view?.levels[0]);
  if (!life || !level) return null;
  return (
    <>
      {life.dishes.map((d) => (
        <DishProp key={d.id} dish={d} level={level} />
      ))}
      <CookingProps level={level} />
      <Servings level={level} />
      <InUse level={level} />
      <TableGameProps level={level} />
    </>
  );
}
