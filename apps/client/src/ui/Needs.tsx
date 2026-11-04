import { LOW_NEED, moodName, moodOf, needsAt, NEEDS, worstNeed, type Avatar, type Need, type NeedValues } from "@cg/shared";
import { useEffect, useRef, useState } from "react";
import { serverNow, toast, useGame } from "../state/game";
import { Floating } from "./Floating";
import "./needs.css";

/**
 * How you (or your partner) are doing, Sims style: a mood up top and a bar for each need, worked out from the
 * server clock between updates (see needs.ts). Folds away to just the mood.
 */

const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Hand-drawn little pictures for each need, in the style of the toolbar's. */
export const NEED_ICON: Record<Need, () => React.JSX.Element> = {
  hunger: () => (
    <svg {...base}>
      <path d="M7.2 3.4v6.3c0 1.3.9 2.2 2 2.2s2-.9 2-2.2V3.5M9.2 3.6v17M16.8 20.7V3.5c-2.1.8-3.3 3.6-3.2 7.2 0 1.6.8 2.5 3.1 2.6" />
    </svg>
  ),
  energy: () => (
    <svg {...base}>
      <path d="M19.6 14.4A8 8 0 0 1 9.4 4.2a8.1 8.1 0 1 0 10.2 10.2z" />
    </svg>
  ),
  hygiene: () => (
    <svg {...base}>
      <path d="M12 3.3c3.1 4 5.6 7.4 5.6 10.6a5.6 5.6 0 0 1-11.2 0c0-3.2 2.5-6.6 5.6-10.6z" />
      <path d="M9.6 14.6c.2 1.3 1 2.2 2.3 2.5" />
    </svg>
  ),
  bladder: () => (
    <svg {...base}>
      <path d="M6.4 4h6.4v6.2H6.3zM4.3 10.3h15.3c0 3.8-2.6 6.4-6.4 6.6l1 3.7H8.1l1-3.9c-3-.6-4.8-3.1-4.8-6.4z" />
    </svg>
  ),
  fun: () => (
    <svg {...base}>
      <path d="m12 3.2 2.6 5.4 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z" />
    </svg>
  ),
  social: () => (
    <svg {...base}>
      <path d="M12 19.6s-7.7-4.4-7.7-9.8a4.1 4.1 0 0 1 7.7-2.1 4.1 4.1 0 0 1 7.7 2.1c0 5.4-7.7 9.8-7.7 9.8z" />
    </svg>
  ),
};

export const NEED_NAME: Record<Need, string> = { hunger: "Hunger", energy: "Energy", hygiene: "Hygiene", bladder: "Bladder", fun: "Fun", social: "Social" };

/** What to do about each, for the hover hint and the nudge when it gets low. */
const NEED_TIP: Record<Need, string> = {
  hunger: "Cook something, then click the plate to eat.",
  energy: "Get some sleep in a bed, or put your feet up.",
  hygiene: "Take a bath, or wash your hands at a sink.",
  bladder: "Find a toilet.",
  fun: "Watch TV, play a game, swim, or shoot some ping pong.",
  social: "Click your partner: hug, dance, chat…",
};

/** What someone acting on their own is up to, for the panel. */
const ON_THEIR_OWN: Record<Need | "rest", string> = {
  hunger: "getting something to eat",
  energy: "having a rest",
  hygiene: "freshening up",
  bladder: "popping to the loo",
  fun: "having some fun",
  social: "looking for company",
  rest: "taking a breather",
};

const NUDGE: Record<Need, string> = {
  hunger: "You're getting hungry",
  energy: "You're worn out",
  hygiene: "You could do with a wash",
  bladder: "You need the loo",
  fun: "You're bored",
  social: "You're feeling lonely",
};

/** A face drawn for a mood from 0 to 100: the mouth curves up or down with it. */
export function MoodFace({ mood, size = 30 }: { mood: number; size?: number }) {
  const curve = ((mood - 50) / 50) * 4.2;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M8.9 9.6v.6M15.1 9.6v.6" strokeWidth={2.4} />
      <path d={`M7.8 15.2 Q12 ${15.2 + curve} 16.2 15.2`} />
    </svg>
  );
}

/** Green when fine, yellow when it wants doing, red when it's pressing. */
export const levelOf = (v: number) => (v < LOW_NEED ? "low" : v < 50 ? "mid" : "ok");

/** Someone's needs right now, redrawn every so often. */
function useNeeds(avatar: Avatar | undefined): NeedValues | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => redraw((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return avatar ? needsAt(avatar, serverNow()) : null;
}

export function NeedsPanel() {
  const me = useGame((s) => s.me);
  const members = useGame((s) => s.members);
  const avatars = useGame((s) => s.life?.avatars);
  const partner = members.find((m) => m.id !== me);
  const [whose, setWhose] = useState<"me" | "partner">("me");
  const showing = whose === "partner" && partner && avatars?.[partner.id] ? partner.id : me;
  const v = useNeeds(showing ? avatars?.[showing] : undefined);
  const mine = useNeeds(me ? avatars?.[me] : undefined);

  // a nudge when one of your own needs first gets low; only the worst, if several do at once
  const low = useRef(new Set<Need>());
  useEffect(() => {
    if (!mine) return;
    let worst: Need | null = null;
    for (const n of NEEDS) {
      if (mine[n] < LOW_NEED && !low.current.has(n)) {
        low.current.add(n);
        if (!worst || mine[n] < mine[worst]) worst = n;
      } else if (mine[n] >= LOW_NEED + 10) low.current.delete(n);
    }
    if (worst) toast(`${NUDGE[worst]}. ${NEED_TIP[worst]}`);
  });

  if (!v) return null;
  const mood = moodOf(v);
  const who = showing === me ? "You" : (partner?.name ?? "Partner");
  const auto = showing ? avatars?.[showing]?.auto : undefined;
  return (
    <Floating
      id="needs"
      title="Needs"
      className="needs-panel"
      aria-label="Needs"
      chip={
        <>
          <span className={`needs-face ${levelOf(mood)}`}>
            <MoodFace mood={mood} size={22} />
          </span>
          {who}: {moodName(mood)}
        </>
      }
    >
      <div className="needs-mood">
        <span className={`needs-face ${levelOf(mood)}`}>
          <MoodFace mood={mood} />
        </span>
        <span className="needs-mood-text">
          <span className="kicker">{who}</span>
          <span className="needs-mood-name">{moodName(mood)}</span>
        </span>
      </div>
      {auto && (
        <p className="needs-auto" title={showing === me ? "Doing things by yourself while you leave them be. Tell them anything and they're yours again." : undefined}>
          On {showing === me ? "your" : "their"} own: {ON_THEIR_OWN[auto.need ?? "rest"]}
        </p>
      )}
      {partner && avatars?.[partner.id] && (
        <div className="seg needs-who">
          <button className={whose === "me" ? "on" : ""} onClick={() => setWhose("me")}>
            You
          </button>
          <button className={whose === "partner" ? "on" : ""} onClick={() => setWhose("partner")}>
            <span className="needs-dot" style={{ background: partner.color }} />
            {partner.name}
          </button>
        </div>
      )}
      <ul className="needs-bars">
        {NEEDS.map((n) => {
          const Pic = NEED_ICON[n];
          return (
            <li key={n} className={levelOf(v[n])} title={`${NEED_NAME[n]}: ${Math.round(v[n])}%. ${NEED_TIP[n]}`}>
              <span className="needs-label">
                <Pic />
                {NEED_NAME[n]}
              </span>
              <span className="needs-bar" role="meter" aria-label={NEED_NAME[n]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v[n])}>
                <span style={{ width: `${v[n]}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </Floating>
  );
}

/** Over someone's head when one of their needs is pressing, like a thought: the need's picture. */
export function NeedThought({ avatar }: { avatar: Avatar }) {
  const v = useNeeds(avatar);
  const worst = v && worstNeed(v);
  if (!worst) return null;
  const Pic = NEED_ICON[worst];
  return (
    <span className="need-thought" title={NUDGE[worst]}>
      <Pic />
    </span>
  );
}
