import { z } from "zod";
import { Id } from "../ops";
import { isVideoId } from "./youtube";

/**
 * Party night: the lights, the dances and the shared music. These are plain definitions (presets, moves, limits,
 * the messages a player may send); the server applies them in `reducer.ts`, and each screen draws what they say.
 * Everything animates from the server clock and these numbers, so both screens show the same party.
 */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** How a preset moves across the lit surfaces. Every pattern is a gentle drift: nothing flashes. */
export type Pattern = "sweep" | "ripple" | "checker" | "pulse";

export interface Preset {
  id: string;
  name: string;
  palette: readonly string[];
  pattern: Pattern;
  /** Seconds for the colours to travel once round the palette. Never under six. */
  period: number;
}

export const PRESETS: readonly Preset[] = [
  { id: "sunset", name: "Sunset", palette: ["#ff5e5b", "#ff9a3c", "#ffd166", "#e0457b", "#8e3bb8"], pattern: "sweep", period: 14 },
  { id: "neon", name: "Neon", palette: ["#00e5ff", "#ff2bd6", "#8a4dff", "#39ff88"], pattern: "ripple", period: 10 },
  { id: "chill", name: "Chill", palette: ["#5ec8ff", "#7a8bff", "#b18cff", "#6ee7c9"], pattern: "pulse", period: 18 },
  { id: "aurora", name: "Aurora", palette: ["#4ade80", "#22d3ee", "#818cf8", "#e879f9"], pattern: "checker", period: 12 },
];
export const PRESET_IDS = PRESETS.map((p) => p.id) as [string, ...string[]];
export const presetOf = (id: string): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[1]!;

/** One-colour choices: the party takes on this colour in place of a preset's. */
export const PARTY_COLORS: readonly { name: string; color: string }[] = [
  { name: "Hot pink", color: "#ff3d9a" },
  { name: "Electric blue", color: "#2f7bff" },
  { name: "Cyan", color: "#18e0e8" },
  { name: "Lime", color: "#8dff3a" },
  { name: "Amber", color: "#ffb02e" },
  { name: "Violet", color: "#9d5cff" },
  { name: "Warm white", color: "#ffe2b8" },
];

export interface PartyLights {
  on: boolean;
  /** 0.1 to 1. */
  brightness: number;
  preset: string;
  /** A single colour instead of the preset's palette. */
  color: string | null;
  /** Steady light: colours and fixtures hold still. */
  steady: boolean;
  /** How wide the lasers fan out, 0.2 to 1. */
  spread: number;
}

export const DEFAULT_LIGHTS: PartyLights = { on: false, brightness: 0.8, preset: "neon", color: null, steady: false, spread: 0.6 };

/** The dances to choose from, each a loop. */
export const DANCES = [
  { id: "bounce", name: "Bounce" },
  { id: "sway", name: "Sway" },
  { id: "disco", name: "Disco point" },
  { id: "hands-up", name: "Hands up" },
  { id: "shuffle", name: "Shuffle" },
] as const;
export type DanceId = (typeof DANCES)[number]["id"];
export const DANCE_IDS = DANCES.map((d) => d.id) as [DanceId, ...DanceId[]];
export const isDance = (s: unknown): s is DanceId => DANCE_IDS.includes(s as DanceId);

/**
 * What a catalog item does for a party: `lights` are driven by the party panel, `music` can play the shared queue
 * (a music player, a DJ booth), `dance` is a dance floor, and `speaker`s just move with the music.
 */
export const PARTY_ROLES = ["lights", "music", "dance", "speaker"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

/** A video in the queue. Only the YouTube ID is kept (no titles, no media). */
export interface Track {
  id: string;
  videoId: string;
  by: string;
  /** Where in the video to begin, from a link with a time in it. */
  start?: number;
}

export interface Music {
  queue: Track[];
  current: Track | null;
  playing: boolean;
  /**
   * Playing: the server time (ms) the video would have been at 0:00, so the position is `now - at`. Paused: how far
   * in it is (ms).
   */
  at: number;
}

export interface PartyState {
  lights: PartyLights;
  music: Music;
}

export const emptyParty = (): PartyState => ({ lights: { ...DEFAULT_LIGHTS }, music: { queue: [], current: null, playing: false, at: 0 } });

export const MAX_QUEUE = 20;
/** The longest a video can run: a position beyond it is a mistake. */
export const MAX_POSITION_MS = 12 * 3_600_000;

/** How far into the current video the shared music is at server time `now` (ms), never below zero. */
export function musicPosition(m: Pick<Music, "playing" | "at">, now: number): number {
  return Math.max(0, m.playing ? now - m.at : m.at);
}

const TrackId = Id;

/** What a player may ask of the party. The server checks each one against the house as it stands. */
export const PartyCmd = z.discriminatedUnion("cmd", [
  z.object({
    cmd: z.literal("lights"),
    set: z
      .object({
        on: z.boolean(),
        brightness: z.number().min(0.1).max(1),
        preset: z.enum(PRESET_IDS),
        color: hex.nullable(),
        steady: z.boolean(),
        spread: z.number().min(0.2).max(1),
      })
      .partial()
      .strict(),
  }),
  /** Queue a video (or, with `now`, start it straight away). */
  z.object({ cmd: z.literal("add"), videoId: z.string().refine(isVideoId, "not a video ID"), start: z.number().int().min(1).max(43_200).optional(), now: z.boolean().optional() }),
  z.object({ cmd: z.literal("play") }),
  z.object({ cmd: z.literal("pause") }),
  z.object({ cmd: z.literal("seek"), ms: z.number().int().min(0).max(MAX_POSITION_MS) }),
  /** Skip to the next video; with `trackId`, only if that's the one playing (so two skips don't skip twice). */
  z.object({ cmd: z.literal("next"), trackId: TrackId.optional() }),
  z.object({ cmd: z.literal("remove"), trackId: TrackId }),
  z.object({ cmd: z.literal("clear") }),
  /** A screen reports the video it was playing reached its end. */
  z.object({ cmd: z.literal("ended"), trackId: TrackId }),
  /** A screen reports YouTube won't play it (private, removed, not embeddable). */
  z.object({ cmd: z.literal("error"), trackId: TrackId, code: z.number().int().min(0).max(1000) }),
]);
export type PartyCmd = z.infer<typeof PartyCmd>;

export type PartyReject = "no-party-items" | "queue-full" | "no-music";
export const PARTY_TEXT: Record<PartyReject, string> = {
  "no-party-items": "Put some party gear in the house first.",
  "queue-full": "The queue is full. Remove a song or wait for one to finish.",
  "no-music": "Place a music player or a DJ booth to play music.",
};
