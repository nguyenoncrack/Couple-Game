import type { MemberInfo } from "@cg/shared";
import type { GameState } from "./game";

/**
 * What the two of you can do together right now: hug and kiss while your partner is here, cuddle (or stop) when
 * you're both in the same bed. The server decides in the end; this just picks which buttons to show.
 */
export function together(s: Pick<GameState, "life" | "members" | "me">): { partner: MemberInfo | null; here: boolean; inBed: boolean; cuddling: boolean } {
  const partner = s.members.find((m) => m.id !== s.me) ?? null;
  const mine = s.me ? s.life?.avatars[s.me]?.use : null;
  const theirs = partner ? s.life?.avatars[partner.id]?.use : null;
  const resting = (u: typeof mine) => u?.action === "sleep" || u?.action === "cuddle";
  const inBed = Boolean(mine?.objectId && mine.objectId === theirs?.objectId && resting(mine) && resting(theirs));
  return { partner, here: Boolean(partner?.online), inBed, cuddling: inBed && mine?.action === "cuddle" };
}
