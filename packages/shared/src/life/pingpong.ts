import { activityAt, arrivalTime, type LifeState } from "./state";

/** Time-based presentation only: both devices derive the same rally without streaming ball positions. */
export function pingPongMoment(life: LifeState, tableId: string, now: number, online?: ReadonlySet<string>) {
  const players = Object.values(life.avatars).filter((a) => a.use?.action === "pingpong" && a.use.objectId === tableId && activityAt(a, now) === "pingpong" && (!online || online.has(a.memberId)));
  if (!players.length) return null;
  const elapsed = Math.max(0, now - Math.max(...players.map(arrivalTime))) / 1000;
  let progress: number, visible = true;
  if (players.length > 1) {
    const t = (elapsed / 0.85) % 2;
    progress = t <= 1 ? t : 2 - t;
  } else {
    const t = elapsed % 2.6;
    visible = t <= 1.3;
    progress = Math.min(1, t / 1.3);
    if (players[0]!.use!.slot === 1) progress = 1 - progress;
  }
  return {
    progress, visible, players: players.length,
    x: -1.35 + progress * 2.7,
    y: 0.78 + Math.abs(Math.cos(progress * Math.PI * 2)) * 0.23,
    z: Math.sin(elapsed * 0.8) * 0.12,
    swing: [Math.max(0, 1 - progress * 8), Math.max(0, 1 - (1 - progress) * 8)],
  };
}
