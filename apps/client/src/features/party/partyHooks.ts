import { arrivalTime, catalog, partyGear, type PartyRole } from "@cg/shared";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { serverNow, useGame } from "../../state/game";

const NONE: Record<PartyRole, boolean> = { lights: false, music: false, dance: false, speaker: false };

/** What party gear the house has. */
export function usePartyGear(): Record<PartyRole, boolean> {
  return useGame(useShallow((s) => (s.view ? partyGear(s.view, catalog) : NONE)));
}

/** Which bit of party gear this player's character is working, once they've got there: the DJ booth or a music player. */
export type GearInUse = "dj" | "tune";

export function useGearInUse(): GearInUse | null {
  const avatar = useGame((s) => (s.me ? s.life?.avatars[s.me] : undefined));
  const action = avatar?.use?.action;
  const gear = action === "dj" || action === "tune" ? action : null;
  const at = avatar && gear ? Math.max(arrivalTime(avatar), avatar.use?.startsAt ?? 0) : 0;
  const [, rerender] = useState(0);
  // the controls come up when the character reaches the gear, not as they set off for it
  useEffect(() => {
    if (!gear) return;
    const wait = at - serverNow();
    if (wait <= 0) return;
    const timer = setTimeout(() => rerender((n) => n + 1), wait + 30);
    return () => clearTimeout(timer);
  }, [gear, at]);
  return gear && serverNow() >= at ? gear : null;
}

/** A value that follows the house's while untouched, and moves at once under a hand, sending now and then. */
export function useSlider(value: number, commit: (v: number) => void, ms = 160) {
  const [local, setLocal] = useState<number | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => setLocal(null), [value]);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    commit(latest.current);
  };
  return {
    value: local ?? value,
    onChange: (v: number) => {
      latest.current = v;
      setLocal(v);
      timer.current ??= setTimeout(flush, ms);
    },
    onRelease: () => {
      if (local !== null) flush();
    },
  };
}
