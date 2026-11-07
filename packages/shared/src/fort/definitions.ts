import { z } from "zod";

/**
 * The blanket fort kit. One fort shape (the frame: a blanket draped over a ridge, with a door to crawl in at the
 * front) and a few pieces that snap onto it. Everything about a fort that isn't a placed object (its blanket
 * pattern, its name and sign, and whether the fairy lights are on) lives in `FortState`, shared by both players
 * and kept with the rest of the house's life.
 */

/** What a kit item is: the frame itself, or a piece that goes on one of its snap points. */
export const FORT_ROLES = ["frame", "mat", "cushion", "plush", "lights"] as const;
export type FortRole = (typeof FORT_ROLES)[number];
export type PieceRole = Exclude<FortRole, "frame">;

/** The frame's footprint, in cells (its entrance is on the +z side before it's turned). */
export const FRAME_SIZE: readonly [number, number] = [3, 2];

/** A blanket pattern: the two colours the client paints it with, and what the catalog calls it. */
export interface BlanketPattern {
  id: string;
  name: string;
  /** The cloth, and the pattern's colour on it. */
  base: string;
  accent: string;
}

export const PATTERNS = [
  { id: "gingham", name: "Strawberry gingham", base: "#f6e3e0", accent: "#e57f93" },
  { id: "stars", name: "Starry night", base: "#2f3b73", accent: "#f8e8a4" },
  { id: "patchwork", name: "Patchwork quilt", base: "#f0d9a8", accent: "#7fb39a" },
] as const satisfies readonly BlanketPattern[];

export type PatternId = (typeof PATTERNS)[number]["id"];
export const PATTERN_IDS = PATTERNS.map((p) => p.id) as [PatternId, ...PatternId[]];
export const isPattern = (id: unknown): id is PatternId => PATTERNS.some((p) => p.id === id);
export const patternOf = (id: string | undefined): BlanketPattern => PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];

export const NAME_MAX = 28;
export const SIGN_MAX = 48;

/** One fort's shared settings. */
export interface FortState {
  /** What the players call it ("" if they haven't named it). */
  name: string;
  /** The handwritten note at the entrance. */
  sign: string;
  pattern: PatternId;
  /** The fairy lights are on, and the fabric glows. */
  lit: boolean;
}

export const emptyFort = (): FortState => ({ name: "", sign: "", pattern: PATTERNS[0].id, lit: false });

/** Plain text for a name or a sign: no control characters, one space between words, cut to length. */
export function cleanText(text: string, max: number): string {
  return [...text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()].slice(0, max).join("").trim();
}

/** What a player can change about a fort. At least one thing at a time; each is checked on the server. */
export const FortCmd = z
  .object({
    pattern: z.enum(PATTERN_IDS).optional(),
    name: z.string().max(200).optional(),
    sign: z.string().max(400).optional(),
    lit: z.boolean().optional(),
  })
  .refine((c) => c.pattern !== undefined || c.name !== undefined || c.sign !== undefined || c.lit !== undefined, "nothing to change");
export type FortCmd = z.infer<typeof FortCmd>;

export type FortReject = "no-fort" | "no-lights";

export const FORT_TEXT: Record<FortReject, string> = {
  "no-fort": "That fort isn't there any more.",
  "no-lights": "Hang some fairy lights on the fort first.",
};

/**
 * Where the kit's pieces snap on, in the frame's own unrotated frame (cells from its corner, facing +z, the
 * entrance at the front). A piece goes on a snap point or nowhere; `turns` ones turn with the frame.
 */
export interface Anchor {
  id: string;
  role: PieceRole;
  x: number;
  z: number;
  w: number;
  d: number;
  turns: boolean;
}

export const ANCHORS: readonly Anchor[] = [
  // the quilted mat lies under the fort and a step out in front of the door
  { id: "mat", role: "mat", x: 0, z: 0, w: 3, d: 3, turns: true },
  // a cushion where each of the two seats is
  { id: "seat-left", role: "cushion", x: 0, z: 1, w: 1, d: 1, turns: false },
  { id: "seat-right", role: "cushion", x: 2, z: 1, w: 1, d: 1, turns: false },
  // the mascot in a back corner, the fairy lights strung along the back
  { id: "plush", role: "plush", x: 0, z: 0, w: 1, d: 1, turns: false },
  { id: "lights", role: "lights", x: 1, z: 0, w: 1, d: 1, turns: true },
];
