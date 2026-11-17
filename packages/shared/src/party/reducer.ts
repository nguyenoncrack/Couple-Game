import type { Blueprint } from "../blueprint";
import type { Catalog } from "../catalog";
import type { LifeState } from "../life/state";
import { anchorDeck, BUILD_BEATS, channelOf, cueFor, deckBeat, DEFAULT_DECK, DROP_BEATS, isRecording, restoredDeck, settleMix, trackBeats, type Deck, type DeckSide, type DeckTrackId } from "./deck";
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
  if (cmd.cmd === "deck" || cmd.cmd === "drop" || cmd.cmd === "mix" || cmd.cmd === "cue" || cmd.cmd === "drop-cue") {
    if (!ctx.gear.music) return { reject: "no-music", changed: false };
    let changed = applyDeck(deckOf(p), cmd, ctx.now);
    // the deck starting puts the YouTube music on hold (only one plays at a time)
    if (p.deck?.playing && p.music.playing) {
      p.music.at = musicPosition(p.music, ctx.now);
      p.music.playing = false;
      changed = true;
    }
    return { reject: null, changed };
  }
  const result = applyMusic(p, cmd as Exclude<PartyCmd, { cmd: DeckCmd }>, ctx);
  // and the YouTube music starting puts the deck on hold
  if (p.music.playing && p.deck?.playing) {
    anchorDeck(p.deck, ctx.now);
    p.deck.playing = false;
    return { ...result, changed: true };
  }
  return result;
}

/** The deck as it stands, made for a party saved before there was one. */
export const deckOf = (p: PartyState): Deck => (p.deck ??= { ...DEFAULT_DECK });

type DeckCmd = "deck" | "drop" | "mix" | "cue" | "drop-cue";

/** Load a record onto a deck (or empty it). A record starts from its beginning: a built-in one on the bar line. */
function load(d: Deck, side: DeckSide, id: DeckTrackId | null, beat: number) {
  if (id === d[side]) return;
  d[side] = id;
  delete d[side === "a" ? "dropCueA" : "dropCueB"];
  const cue = side === "a" ? "cueA" : "cueB";
  if (id) d[cue] = cueFor(id, beat, 0);
  else delete d[cue];
}

/** Work the deck. Reports whether anything changed. */
function applyDeck(d: Deck, cmd: Extract<PartyCmd, { cmd: DeckCmd }>, now: number): boolean {
  const beat = deckBeat(d, now);
  settleMix(d, beat);
  if (cmd.cmd === "drop") {
    if (!d.playing) return false;
    // one drop at a time
    if (d.drop !== null && beat < d.drop + BUILD_BEATS + DROP_BEATS) return false;
    // the build starts on the next bar line
    d.drop = Math.ceil(beat / 4) * 4;
    return true;
  }
  if (cmd.cmd === "mix") {
    // one transition at a time, while the music plays, and only to a deck with a record on it
    if (!d.playing || d.mix) return false;
    const to: 0 | 1 = d.xfade < 0.5 ? 1 : 0;
    if (!d[to === 1 ? "b" : "a"]) return false;
    d.mix = { style: cmd.style, from: d.xfade, to, start: Math.ceil(beat / 4 - 1e-9) * 4, beats: cmd.bars * 4 };
    return true;
  }
  if (cmd.cmd === "cue") {
    const id = d[cmd.side];
    if (!id || (cmd.track !== undefined && cmd.track !== id)) return false;
    const key = cmd.side === "a" ? "cueA" : "cueB";
    const cue = cueFor(id, beat, cmd.pos);
    if (cue === d[key]) return false;
    d[key] = cue;
    return true;
  }
  if (cmd.cmd === "drop-cue") {
    const { side, track, pos } = cmd;
    if (d[side] !== track) return false;
    const marker = side === "a" ? "dropCueA" : "dropCueB";
    if (pos !== undefined) {
      const withinTrack = Math.min(pos, trackBeats(track) - 0.01);
      const drop = isRecording(track) ? withinTrack : Math.floor(withinTrack / 4) * 4;
      if (d[marker] === drop) return false;
      d[marker] = drop;
      return true;
    }
    const drop = d[marker];
    if (drop === undefined) return false;
    d[side === "a" ? "cueA" : "cueB"] = cueFor(track, beat, drop);
    anchorDeck(d, now);
    d.playing = true;
    d.xfade = side === "a" ? 0 : 1;
    d.mix = null;
    d.drop = null;
    return true;
  }
  const before = JSON.stringify(d);
  const { playing, bpm, a, b, chA, chB, xfade, ...rest } = cmd.set;
  if (a !== undefined) load(d, "a", a, beat);
  if (b !== undefined) load(d, "b", b, beat);
  if (chA) d.chA = { ...channelOf(d, "a"), ...chA };
  if (chB) d.chB = { ...channelOf(d, "b"), ...chB };
  // a hand on the crossfader takes over from a transition; it starts from where the transition had got to
  if (xfade !== undefined) {
    d.xfade = xfade;
    if (d.mix) d.mix = null;
  }
  // the beat is re-anchored before the tempo changes or the music stops or starts, so it carries on from where it is
  if ((playing !== undefined && playing !== d.playing) || (bpm !== undefined && bpm !== d.bpm)) anchorDeck(d, now);
  if (bpm !== undefined) d.bpm = bpm;
  if (playing !== undefined) d.playing = playing;
  Object.assign(d, rest);
  if (!d.a || !d.b) {
    d.mix = null;
    if (d.a) d.xfade = 0;
    else if (d.b) d.xfade = 1;
    else {
      if (d.playing) anchorDeck(d, now);
      d.playing = false;
      d.drop = null;
    }
  }
  return JSON.stringify(d) !== before;
}

function applyMusic(p: PartyState, cmd: Exclude<PartyCmd, { cmd: DeckCmd }>, ctx: PartyContext): { reject: PartyReject | null; changed: boolean } {
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
  let changed = false;
  const d = state.party?.deck;
  if (d?.playing) {
    anchorDeck(d, now);
    d.playing = false;
    changed = true;
  }
  const m = state.party?.music;
  if (!m?.playing) return changed;
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
    ...(party.deck ? { deck: restoredDeck({ ...party.deck, beat: deckBeat(party.deck, now) }) } : {}),
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
    deck: restoredDeck(saved.deck),
  };
}
