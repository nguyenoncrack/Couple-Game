import { catalog, liftHeight, liftOpenAt, liftsIn, liftStops, STOREY, type Lift, type PlacedObject } from "@cg/shared";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow, useGame } from "../state/game";
import { objectTransform } from "./House";
import { topShown } from "./Storeys";
import { KitMesh, Meshes } from "./KitMesh";
import { LIFT_DOOR_H, modelFor } from "./models";
import { pencilMaterial } from "./pencil";

/**
 * Lifts, past the ground floor's stretch of shaft (which is the lift's own model): the shaft again on each floor
 * above that you can see, the car riding up and down it, and at each floor it stops at a pair of doors that slide
 * open when it's there and a call button that lights up when it's been called.
 */

const IDLE: Lift = { level: 0, stops: [] };
const unit = new THREE.BoxGeometry(1, 1, 1);
const DOOR = pencilMaterial("#dcd6ca", { finish: "metal" });
const LIT = pencilMaterial("#ffd65a", { finish: "paint" });
const UNLIT = pencilMaterial("#b9c0bd", { finish: "metal" });

const carOf = (id: string) => useGame.getState().life?.lifts?.[id] ?? IDLE;

export function Lifts() {
  const view = useGame((s) => s.view);
  const top = useGame(topShown);
  const lifts = useMemo(() => (view ? liftsIn(view, catalog).map(({ o }) => ({ o, stops: liftStops(view, o.id, catalog).map((s) => s.level) })) : []), [view]);
  if (!view) return null;
  return (
    <>
      {lifts.map(({ o, stops }) => (
        <OneLift key={o.id} o={o} stops={stops} top={top} />
      ))}
    </>
  );
}

function OneLift({ o, stops, top }: { o: PlacedObject; stops: number[]; top: number }) {
  const { item, position, rotationY } = objectTransform(o);
  const meshes = modelFor(item);
  const [w, d] = item.footprint;
  // clicking the shaft upstairs is clicking the lift (in Live mode: pick a floor)
  const pick = (e: ThreeEvent<PointerEvent>, level: number) => {
    if (e.button !== 0 || useGame.getState().mode !== "live") return;
    e.stopPropagation();
    useGame.setState({ menu: { objectId: o.id, at: [position[0], level * STOREY + 2.6, position[2]] } });
  };
  return (
    <group position={position} rotation-y={rotationY}>
      {Array.from({ length: top }, (_, i) => i + 1).map((i) => (
        <group key={i} position-y={i * STOREY} onPointerDown={(e) => pick(e, i)}>
          <Meshes meshes={meshes} />
        </group>
      ))}
      <Car id={o.id} w={w} d={d} />
      {stops
        .filter((l) => l <= top)
        .map((l) => (
          <Doors key={l} id={o.id} level={l} w={w} d={d} />
        ))}
    </group>
  );
}

/** The car: floor, ceiling and a back wall with a rail, riding at the height the lift says. */
function Car({ id, w, d }: { id: string; w: number; d: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    const h = liftHeight(carOf(id), serverNow());
    g.current.position.y = h;
    // not on a floor above the one you're looking at
    g.current.visible = Math.floor(h / STOREY + 0.02) <= topShown(useGame.getState());
  });
  const W = w - 0.3;
  const D = d - 0.3;
  return (
    <group ref={g}>
      <KitMesh
        deps={[w, d]}
        make={(k) => {
          const car = pencilMaterial("#f6f1e7", { finish: "paint" });
          const trim = pencilMaterial("#b8ab94", { finish: "metal" });
          k.box(pencilMaterial("#cdbfa6", { finish: "wood" }), [0, 0.01, 0], [W, 0.02, D], { outline: 0.004 });
          k.box(car, [0, LIFT_DOOR_H + 0.06, 0], [W, 0.05, D], { outline: 0.004 });
          k.box(pencilMaterial("#fff3c4", { finish: "paint" }), [0, LIFT_DOOR_H + 0.025, 0], [W * 0.5, 0.02, D * 0.5], { outline: false });
          k.box(car, [0, LIFT_DOOR_H / 2 + 0.04, -D / 2 + 0.02], [W, LIFT_DOOR_H + 0.04, 0.04], { outline: 0.004 });
          k.box(trim, [0, 0.95, -D / 2 + 0.08], [W - 0.2, 0.04, 0.04], { outline: 0.004 });
        }}
      />
    </group>
  );
}

/** A pair of doors at one floor, folding back to the sides while the car's there with them open, and its call button. */
function Doors({ id, level, w, d }: { id: string; level: number; w: number; d: number }) {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const button = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const span = w - 0.26;
  const z = d / 2 - 0.05;
  useFrame((_, dt) => {
    const car = carOf(id);
    const t = serverNow();
    const target = liftOpenAt(car, level, t) ? 1 : 0;
    open.current += (target - open.current) * (1 - Math.exp(-dt * 6));
    const panel = (span / 2) * (1 - 0.82 * open.current);
    for (const [m, sx] of [
      [left.current, -1],
      [right.current, 1],
    ] as const) {
      if (!m) continue;
      m.scale.set(panel, LIFT_DOOR_H - 0.04, 0.04);
      m.position.set(sx * (span / 2 - panel / 2), LIFT_DOOR_H / 2, z);
    }
    if (button.current) button.current.material = car.stops.includes(level) ? LIT : UNLIT;
  });
  return (
    <group position-y={level * STOREY}>
      <mesh ref={left} geometry={unit} material={DOOR} />
      <mesh ref={right} geometry={unit} material={DOOR} />
      <mesh ref={button} geometry={unit} material={UNLIT} position={[w / 2 - 0.08, 1.1, d / 2 + 0.005]} scale={[0.06, 0.06, 0.02]} />
    </group>
  );
}
