import { catalog, footprintOf, STOREY } from "@cg/shared";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";
import { useGame } from "../state/game";
import { Ghost, OpeningGhost, openingFootprint, rotToOpening } from "../tools/BuildTools";
import { FootprintMarker } from "./House";
import { topShown } from "./Storeys";

/**
 * What my partner is up to: a pencil-pin cursor with their name, the ghost of whatever they're carrying, and a
 * coloured outline around anything they're holding, each on the floor it's on (and not on a floor hidden above mine).
 */
export function PartnerPresence() {
  const me = useGame((s) => s.me);
  const members = useGame((s) => s.members);
  const presence = useGame((s) => s.presence);
  const holds = useGame((s) => s.holds);
  const view = useGame((s) => s.view);
  const top = useGame(topShown);

  return (
    <>
      {members
        .filter((m) => m.id !== me && m.online)
        .map((m) => {
          const p = presence[m.id];
          const on = Math.min(p?.level ?? 0, (view?.levels.length ?? 1) - 1);
          if (on > top) return null;
          return (
            <group key={m.id} position-y={on * STOREY}>
              {p?.cursor && <Pin x={p.cursor.x} z={p.cursor.z} color={m.color} name={m.name} tool={p.tool} />}
              {p?.drag && catalog.furniture.has(p.drag.catalogId) && (
                <Ghost catalogId={p.drag.catalogId} x={p.drag.x} z={p.drag.z} rot={p.drag.rot} ignore={p.drag.objectId} color={m.color} level={on} />
              )}
              {p?.drag && catalog.openings.has(p.drag.catalogId) && (
                <OpeningGhost catalogId={p.drag.catalogId} x={p.drag.x} z={p.drag.z} {...rotToOpening(p.drag.rot)} ignore={p.drag.objectId} color={m.color} on={on} />
              )}
            </group>
          );
        })}
      {view &&
        Object.entries(holds).map(([objectId, memberId]) => {
          if (memberId === me) return null;
          const m = members.find((x) => x.id === memberId);
          const i = view.levels.findIndex((l) => l.objects[objectId] || l.openings[objectId]);
          const level = view.levels[i];
          if (!m || !level || i > top) return null;
          const o = level.objects[objectId];
          const item = o && catalog.furniture.get(o.catalogId);
          const w = level.openings[objectId];
          const wi = w && catalog.openings.get(w.catalogId);
          return (
            <group key={objectId} position-y={i * STOREY}>
              {o && item ? <FootprintMarker {...footprintOf(item, o)} color={m.color} /> : w && wi ? <FootprintMarker {...openingFootprint(w, wi)} color={m.color} /> : null}
            </group>
          );
        })}
    </>
  );
}

const TOOL_WORDS: Record<string, string> = {
  wall: "building walls",
  wallErase: "knocking down walls",
  floor: "laying floors",
  floorErase: "lifting floors",
  buy: "shopping",
};

function Pin({ x, z, color, name, tool }: { x: number; z: number; color: string; name: string; tool: string }) {
  const ref = useRef<THREE.Group>(null);
  // Glide toward the latest position instead of jumping between network updates.
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 14);
    g.position.x += (x - g.position.x) * k;
    g.position.z += (z - g.position.z) * k;
  });
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[0.16, 0.24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.55, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.02, 0.02, 1, 6]} />
        <meshBasicMaterial color="#3a3631" />
      </mesh>
      <Html position={[0, 1.15, 0]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="pin-tag" style={{ borderColor: color }}>
          <span className="pin-dot" style={{ background: color }} />
          {name}
          {TOOL_WORDS[tool] && <span className="pin-tool"> · {TOOL_WORDS[tool]}</span>}
        </div>
      </Html>
    </group>
  );
}
