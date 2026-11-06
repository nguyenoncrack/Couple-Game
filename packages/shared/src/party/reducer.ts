import type { Blueprint } from "../blueprint";
import type { Catalog } from "../catalog";
import type { LifeState } from "../life/state";
import { emptyParty, MAX_QUEUE, musicPosition, PARTY_ROLES, type PartyCmd, type PartyReject, type PartyRole, type PartyState, type Track } from "./definitions";

/** What party gear the house has: any item with that role, on any floor. */
export function partyGear(bp: Blueprint, cat: Catalog): Record<PartyRole, boolean> {
  const gear = Object.fromEntries(PARTY_ROLES.map((r) => [r, false])) as Record<PartyRole, boolean>;
  for (const level of bp.levels) for (const o of Object.values(level.objects)) for (const r of cat.furniture.get(o.catalogId)?.party ?? []) gear[r] = true;
  return gear;
}

export interface PartyContext {
  memberId: string;
  /** Server clock, milliseconds. */
  now: number;
  newId: () => string;
  gear: Record<PartyRole, boolean>;
}

/** The party as it stands, made if the house has never had one (older saves). */
export const partyOf = (state: LifeState): PartyState => (state.party ??= emptyParty());

/** Make the next video the current one, or stop if there's none. */
function advance(p: PartyState, now: number) {
  const m = p.music;
  m.current = m.queue.shift() ?? null;
  m.playing = Boolean(m.current);
  m.at = m.current ? now - (m.current.start ?? 0) * 1000 : 0;
}

/**
 * Apply one party command from a member of the house. Lights need some lighting gear (or a dance floor), the queue
 * needs a music player or DJ booth. Reports why not, or whether anything changed (a late "ended" for a video that's
 * already been skipped changes nothing).
 */
export function applyParty(state: LifeState, cmd: PartyCmd, ctx: PartyContext): { reject: PartyReject | null; changed: boolean } {
  const p = partyOf(state);
  const m = p.music;
  const { now } = ctx;
  const done = (changed: boolean) => ({ reject: null, changed });
  const refuse = (reject: PartyReject) => ({ reject, changed: false });

  if (cmd.cmd === "lights") {
    if (!ctx.gear.lights && !ctx.gear.dance) return refuse("no-party-items");
    const before = JSON.stringify(p.lights);
    Object.assign(p.lights, cmd.set);
    // choosing a preset puts the single colour away; choosing a colour doesn't change the preset
    if (cmd.set.preset !== undefined && cmd.set.color === undefined) p.lights.color = null;
    return done(JSON.stringify(p.lights) !== before);
  }
  if (!ctx.gear.music) return refuse("no-music");

  switch (cmd.cmd) {
    case "add": {
      if (m.queue.length + (m.current ? 1 : 0) >= MAX_QUEUE) return refuse("queue-full");
      const track: Track = { id: ctx.newId(), videoId: cmd.videoId, by: ctx.memberId, ...(cmd.start ? { start: cmd.start } : {}) };
      if (cmd.now || !m.current) {
        m.current = track;
        m.playing = true;
        m.at = now - (track.start ?? 0) * 1000;
      } else m.queue.push(track);
      return done(true);
    }
    case "play": {
      if (!m.current) {
        if (!m.queue.length) return done(false);
        advance(p, now);
        return done(true);
      }
      if (m.playing) return done(false);
      m.at = now - m.at;
      m.playing = true;
      return done(true);
    }
    case "pause": {
      if (!m.current || !m.playing) return done(false);
      m.at = musicPosition(m, now);
      m.playing = false;
      return done(true);
    }
    case "seek": {
      if (!m.current) return done(false);
      m.at = m.playing ? now - cmd.ms : cmd.ms;
      return done(true);
    }
    case "next": {
      if (cmd.trackId && m.current?.id !== cmd.trackId) return done(false);
      if (!m.current && !m.queue.length) return done(false);
      advance(p, now);
      return done(true);
    }
    case "ended":
    case "error": {
      if (m.current?.id === cmd.trackId) {
        advance(p, now);
        return done(true);
      }
      // a video that won't play, still waiting its turn: take it out
      if (cmd.cmd === "error" && m.queue.some((t) => t.id === cmd.trackId)) {
        m.queue = m.queue.filter((t) => t.id !== cmd.trackId);
        return done(true);
      }
      return done(false);
    }
    case "remove": {
      if (m.current?.id === cmd.trackId) {
        advance(p, now);
        return done(true);
      }
      const before = m.queue.length;
      m.queue = m.queue.filter((t) => t.id !== cmd.trackId);
      return done(m.queue.length !== before);
    }
    case "clear": {
      if (!m.queue.length) return done(false);
      m.queue = [];
      return done(true);
    }
  }
}

/** Nobody's here: the music holds where it is, so it's waiting at the same place when they come back. */
export function pauseMusic(state: LifeState, now: number): boolean {
  const m = state.party?.music;
  if (!m?.playing) return false;
  m.at = musicPosition(m, now);
  m.playing = false;
  return true;
}

/** What to keep of the party between sessions: the lights as set, the queue, and the music paused where it was. */
export function savedParty(party: PartyState, now: number): PartyState {
  const m = party.music;
  return {
    lights: { ...party.lights },
    music: { queue: m.queue.map((t) => ({ ...t })), current: m.current ? { ...m.current } : null, playing: false, at: m.current ? musicPosition(m, now) : 0 },
  };
}

/** A saved party, checked into shape (older or damaged saves become a quiet party rather than an error). */
export function restoredParty(saved: PartyState | undefined): PartyState | undefined {
  if (!saved || typeof saved !== "object") return undefined;
  const base = emptyParty();
  const m = saved.music;
  const track = (t: Track | null | undefined): Track | null => (t && typeof t.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(t.videoId) ? { id: t.id, videoId: t.videoId, by: String(t.by ?? ""), ...(t.start ? { start: t.start } : {}) } : null);
  return {
    lights: { ...base.lights, ...saved.lights },
    music: {
      queue: (m?.queue ?? []).map(track).filter((t): t is Track => t !== null).slice(0, MAX_QUEUE),
      current: track(m?.current),
      playing: false,
      at: Number.isFinite(m?.at) ? Math.max(0, m!.at) : 0,
    },
  };
}
