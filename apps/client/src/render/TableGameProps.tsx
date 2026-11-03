import { cardLabel, pingPongMoment, type BlackjackRound, type Level, type LifeState } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow, useGame } from "../state/game";
import { objectTransform } from "./House";
import { pencilMaterial } from "./pencil";

// A bounded cache (52 faces plus one back); no network fonts or image assets are needed.
const cardTextures = new Map<number, THREE.CanvasTexture>();
function cardTexture(card: number) {
  const cached = cardTextures.get(card);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff9ea"; ctx.fillRect(0, 0, 128, 192);
  ctx.strokeStyle = "#b6a68b"; ctx.lineWidth = 3; ctx.strokeRect(4, 4, 120, 184);
  if (card < 0) {
    ctx.fillStyle = "#b7655a"; ctx.fillRect(9, 9, 110, 174);
    ctx.fillStyle = "#edd1b9";
    for (let x = 19; x < 120; x += 18) for (let y = 19; y < 180; y += 18) ctx.fillRect(x, y, 6, 6);
  } else {
    const { rank, suit, red } = cardLabel(card);
    ctx.fillStyle = red ? "#b4544a" : "#343b3c";
    ctx.font = "bold 27px Georgia"; ctx.fillText(rank, 12, 32);
    ctx.font = "25px Georgia"; ctx.fillText(suit, 12, 58);
    ctx.textAlign = "center"; ctx.font = "64px Georgia"; ctx.fillText(suit, 64, 126);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cardTextures.set(card, texture);
  return texture;
}

function Card({ card, x, z, layer = 0 }: { card: number; x: number; z: number; layer?: number }) {
  const texture = useMemo(() => cardTexture(card), [card]);
  return <group position={[x, 0.798 + layer * 0.004, z]}>
    <mesh raycast={() => null} material={pencilMaterial("#f5ead4")}><boxGeometry args={[0.12, 0.005, 0.18]} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, 0]} raycast={() => null}><planeGeometry args={[0.115, 0.175]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>
  </group>;
}

function CardsOnTable({ round }: { round: BlackjackRound }) {
  return <>
    {round.dealer.map((card, i) => <Card key={card} card={card} x={(i - (round.dealer.length - 1) / 2) * 0.04} z={-0.18} layer={i} />)}
    {round.phase === "playing" && <Card card={-1} x={0.15} z={-0.18} />}
    {Object.values(round.hands).map((hand, player) => hand.cards.map((card, i) => <Card key={card} card={card} x={((hand.seat ?? player) ? 0.32 : -0.32) + (i - (hand.cards.length - 1) / 2) * 0.026} z={0.17} layer={i} />))}
  </>;
}

function Ball({ tableId, life, online }: { tableId: string; life: LifeState; online: Set<string> }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const ball = ref.current;
    if (!ball) return;
    const moment = pingPongMoment(life, tableId, serverNow(), online);
    ball.visible = Boolean(moment?.visible);
    if (moment) ball.position.set(moment.x, moment.y, moment.z);
  });
  return <mesh ref={ref} visible={false} material={pencilMaterial("#fff1d0")} raycast={() => null}><sphereGeometry args={[0.024, 12, 8]} /></mesh>;
}

export function TableGameProps({ level }: { level: Level }) {
  const life = useGame((s) => s.life);
  const members = useGame((s) => s.members);
  const online = useMemo(() => new Set(members.filter((m) => m.online).map((m) => m.id)), [members]);
  if (!life) return null;
  const tables = new Map<string, "pingpong" | "blackjack">();
  for (const a of Object.values(life.avatars)) if (a.use?.objectId && (a.use.action === "pingpong" || a.use.action === "blackjack")) tables.set(a.use.objectId, a.use.action);
  return <>{[...tables].map(([id, action]) => {
    const object = level.objects[id];
    if (!object) return null;
    const { position, rotationY } = objectTransform(object);
    return <group key={id} position={position} rotation-y={rotationY}>
      {action === "pingpong" && <Ball tableId={id} life={life} online={online} />}
      {action === "blackjack" && life.blackjack?.[id] && <CardsOnTable round={life.blackjack[id]} />}
    </group>;
  })}</>;
}
