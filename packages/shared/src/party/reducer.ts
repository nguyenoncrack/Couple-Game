import type { Blueprint } from "../blueprint";
import type { Catalog } from "../catalog";
import type { LifeState } from "../life/state";
import {
  anchorDeck,
  BUILD_BEATS,
  channelOf,
  cueFor,
  deckBeat,
  DEFAULT_DECK,
  DROP_BEATS,
  holdOf,
  isParked,
  isRecording,
  MAX_MARKS,
  mixAt,
  mixInto,
  mixOut,
  mixQueued,
  otherSide,
  placeIn,
  restoredDeck,
  settleMix,
  trackBeats,
  trackPosition,
  waitOf,
  type Deck,
  type DeckMix,
  type DeckSide,
  type DeckTrackId,
} from "./deck";
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
  if (isDeckCmd(cmd)) {
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

type DeckCmd = (typeof DECK_CMDS)[number];
const DECK_CMDS = ["deck", "drop", "mix", "cue", "drop-cue", "transport", "mark", "mixnow", "unmix"] as const;
export const isDeckCmd = (cmd: PartyCmd): cmd is Extract<PartyCmd, { cmd: DeckCmd }> => (DECK_CMDS as readonly string[]).includes(cmd.cmd);

const S = (side: DeckSide) => (side === "a" ? "A" : "B");

/** Let a deck's record move with the deck's clock again (not paused or parked on its own). */
function release(d: Deck, side: DeckSide) {
  delete d[`hold${S(side)}`];
  delete d[`wait${S(side)}`];
}

/** Put a deck `pos` into its record at `beat`, moving with the clock from there. */
function placeAt(d: Deck, side: DeckSide, id: DeckTrackId, pos: number, beat: number, exact = true) {
  release(d, side);
  const p = placeIn(id, pos);
  d[`cue${S(side)}`] = exact ? beat - p : cueFor(id, beat, p);
}

/** Pause a deck on its own at a place in its record. */
function holdAt(d: Deck, side: DeckSide, id: DeckTrackId, pos: number) {
  release(d, side);
  d[`hold${S(side)}`] = placeIn(id, pos);
}

/** Load a record onto a deck (or empty it). A record starts from its beginning: a built-in one on the bar line. */
function load(d: Deck, side: DeckSide, id: DeckTrackId | null, beat: number) {
  if (id === d[side]) return;
  d[side] = id;
  delete d[`dropCue${S(side)}`];
  release(d, side);
  if (id) placeAt(d, side, id, 0, beat, false);
  else delete d[`cue${S(side)}`];
}

/**
 * Keep a queued transition on time: it starts when the outgoing record gets to `at`, so its start beat follows that
 * record (and is unknown while it's paused). The incoming record waits parked at `inAt` until then. A jump past
 * `at` calls it off.
 */
function scheduleMix(d: Deck, beat: number) {
  const m = d.mix;
  // (a transition starting on this very beat still puts its incoming record in place)
  if (!m || (m.start !== null && beat > m.start)) return;
  const out = mixOut(m);
  const into = mixInto(m);
  if (!d[out] || !d[into]) return cancelMix(d, beat);
  if (m.at !== undefined) {
    if (holdOf(d, out) !== undefined) m.start = null;
    else {
      const from = Math.max(beat, waitOf(d, out) ?? -Infinity);
      const pos = trackPosition(d, out, from)!;
      if (m.at < pos - 1e-6) return cancelMix(d, beat);
      m.start = from + (m.at - pos);
    }
  }
  if (m.inAt !== undefined) {
    if (m.start === null) holdAt(d, into, d[into]!, m.inAt);
    else {
      release(d, into);
      d[`cue${S(into)}`] = m.start - m.inAt;
      d[`wait${S(into)}`] = m.start;
    }
  }
}

/** Call a transition off: a queued one leaves the incoming record paused at its starting place; one under way stops where it got to. */
function cancelMix(d: Deck, beat: number) {
  const m = d.mix;
  if (!m) return;
  if (mixQueued(m, beat)) {
    const into = mixInto(m);
    if (m.inAt !== undefined && d[into]) holdAt(d, into, d[into]!, m.inAt);
  } else d.xfade = mixAt(d, beat).xfade;
  d.mix = null;
}

/** Work the deck. Reports whether anything changed. */
function applyDeck(d: Deck, cmd: Extract<PartyCmd, { cmd: DeckCmd }>, now: number): boolean {
  const beat = deckBeat(d, now);
  const before = JSON.stringify(d);
  settleMix(d, beat);
  runDeck(d, cmd, beat, now);
  scheduleMix(d, beat);
  return JSON.stringify(d) !== before;
}

/** One deck command. `false` means it doesn't apply (it changes nothing). */
function runDeck(d: Deck, cmd: Extract<PartyCmd, { cmd: DeckCmd }>, beat: number, now: number): boolean | void {
  const play = () => {
    if (d.playing) return;
    anchorDeck(d, now);
    d.playing = true;
  };
  switch (cmd.cmd) {
    case "drop": {
      if (!d.playing) return false;
      // one drop at a time
      if (d.drop !== null && beat < d.drop + BUILD_BEATS + DROP_BEATS) return false;
      // the build starts on the next bar line
      d.drop = Math.ceil(beat / 4) * 4;
      return;
    }
    case "mix": {
      // one transition at a time, and only to a deck with a record on it
      if (d.mix) return false;
      const to: 0 | 1 = d.xfade < 0.5 ? 1 : 0;
      const out: DeckSide = to === 1 ? "a" : "b";
      const into = otherSide(out);
      const outId = d[out];
      const inId = d[into];
      if (!inId || !outId) return false;
      const mix: DeckMix = { style: cmd.style, from: d.xfade, to, start: null, beats: cmd.bars * 4 };
      // a paused incoming record comes in from where it's held
      const inAt = cmd.inAt ?? holdOf(d, into) ?? (isParked(d, into, beat) ? trackPosition(d, into, beat)! : undefined);
      if (inAt !== undefined) mix.inAt = placeIn(inId, inAt);
      if (cmd.at === undefined) {
        // now: from the next bar line, while the music plays
        if (!d.playing) return false;
        mix.start = Math.ceil(beat / 4 - 1e-9) * 4;
      } else {
        mix.at = placeIn(outId, cmd.at);
        const pos = trackPosition(d, out, beat)!;
        if (holdOf(d, out) === undefined && !isParked(d, out, beat) && mix.at < pos - 1e-6) return false;
      }
      d.mix = mix;
      return;
    }
    case "mixnow": {
      const m = d.mix;
      if (!m || !mixQueued(m, beat)) return false;
      m.start = beat;
      delete m.at;
      const into = mixInto(m);
      if (m.inAt !== undefined) placeAt(d, into, d[into]!, m.inAt, beat);
      const out = mixOut(m);
      // the outgoing record plays out under the transition
      if (holdOf(d, out) !== undefined) placeAt(d, out, d[out]!, holdOf(d, out)!, beat);
      play();
      return;
    }
    case "unmix": {
      if (!d.mix) return false;
      cancelMix(d, beat);
      return;
    }
    case "transport": {
      const { side } = cmd;
      const id = d[side];
      if (!id) return false;
      // a record waiting for its transition comes in with it
      const m = d.mix;
      if (m && mixQueued(m, beat) && mixInto(m) === side && m.inAt !== undefined) return false;
      if (cmd.playing) {
        const hold = holdOf(d, side);
        if (!d.playing) {
          // only this deck: the other one stays where it is (unless a transition needs them both)
          const other = otherSide(side);
          if (!m && d[other] && holdOf(d, other) === undefined) holdAt(d, other, d[other]!, trackPosition(d, other, beat)!);
          play();
        }
        if (hold !== undefined) placeAt(d, side, id, hold, beat);
        return;
      }
      if (holdOf(d, side) !== undefined) return false;
      holdAt(d, side, id, trackPosition(d, side, beat)!);
      return;
    }
    case "cue": {
      const { side } = cmd;
      const id = d[side];
      if (!id || (cmd.track !== undefined && cmd.track !== id)) return false;
      const m = d.mix;
      // the incoming record of a queued transition: that's where it will come in from
      if (m && mixQueued(m, beat) && mixInto(m) === side && m.inAt !== undefined) {
        m.inAt = placeIn(id, cmd.pos);
        return;
      }
      if (holdOf(d, side) !== undefined) return holdAt(d, side, id, cmd.pos);
      placeAt(d, side, id, cmd.pos, beat, isRecording(id));
      return;
    }
    case "mark": {
      const { track } = cmd;
      const list = [...(d.marks?.[track] ?? [])];
      const p = placeIn(track, cmd.pos);
      const i = list.findIndex((q) => Math.abs(q - p) < 0.05);
      if (cmd.remove) {
        if (i < 0) return false;
        list.splice(i, 1);
      } else {
        if (i >= 0 || list.length >= MAX_MARKS) return false;
        list.push(p);
        list.sort((x, y) => x - y);
      }
      d.marks ??= {};
      if (list.length) d.marks[track] = list;
      else delete d.marks[track];
      return;
    }
    case "drop-cue": {
      const { side, track, pos } = cmd;
      if (d[side] !== track) return false;
      const marker = `dropCue${S(side)}` as const;
      if (pos !== undefined) {
        const withinTrack = Math.min(pos, trackBeats(track) - 0.01);
        const drop = isRecording(track) ? withinTrack : Math.floor(withinTrack / 4) * 4;
        if (d[marker] === drop) return false;
        d[marker] = drop;
        return;
      }
      const drop = d[marker];
      if (drop === undefined) return false;
      if (d.mix) cancelMix(d, beat);
      d.mix = null;
      placeAt(d, side, track, drop, beat, isRecording(track));
      play();
      d.xfade = side === "a" ? 0 : 1;
      d.drop = null;
      return;
    }
    case "deck": {
      const { playing, bpm, a, b, chA, chB, xfade, ...rest } = cmd.set;
      for (const [side, id] of [["a", a], ["b", b]] as const) {
        if (id === undefined || id === d[side]) continue;
        load(d, side, id, beat);
        // a new record calls off a transition
        if (d.mix) cancelMix(d, beat);
      }
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
      return;
    }
  }
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
