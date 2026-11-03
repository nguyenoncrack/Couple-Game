import {
  applyOp,
  inverseOp,
  LIFE_TEXT,
  newId,
  REJECT_TEXT,
  type Blueprint,
  type HouseState,
  type LifeIntent,
  type LifeState,
  type MemberInfo,
  type Op,
  type Presence,
  type Rot,
  type ServerMsg,
  undoCheck,
} from "@cg/shared";
import { create } from "zustand";
import { Connection } from "../net/connection";
import { updateHouse, type SavedHouse } from "../net/session";
import type { WallMode } from "../render/House";

/**
 * Game state on the client. The server's confirmed house plus my edits it hasn't confirmed yet (`pending`) make
 * the house I see (`view`). When the server confirms anything (mine or my partner's), pending edits are replayed
 * on top of the new confirmed house; any that no longer make sense are dropped quietly with a note.
 */

export type Tool = "select" | "wall" | "wallErase" | "floor" | "floorErase" | "buy";
export type Status = "connecting" | "online" | "reconnecting" | "gone";
/** Build: change the house. Live: be in it, with your character. */
export type Mode = "build" | "live";

/** What the interaction menu is open on: a piece of furniture or a plate, and where to show it. */
export interface Menu {
  objectId?: string;
  dishId?: string;
  at: [number, number, number];
}

interface Pending {
  clientOpId: string;
  op: Op;
}

interface Toast {
  id: number;
  text: string;
}

export interface GameState {
  house: SavedHouse | null;
  me: string | null;
  members: MemberInfo[];
  status: Status;
  /** Why we were sent away, when status is "gone". */
  goneReason: string;
  confirmed: HouseState | null;
  pending: Pending[];
  view: Blueprint | null;
  holds: Record<string, string>;
  presence: Record<string, Presence>;

  tool: Tool;
  wallStyle: string;
  floorMaterial: string;
  /** The catalog item being placed with the buy tool, and its rotation. */
  placing: { catalogId: string; rot: Rot } | null;
  /** A selected object, door or window. */
  selection: string | null;
  wallMode: WallMode;
  canUndo: boolean;
  canRedo: boolean;
  catalogOpen: boolean;
  toasts: Toast[];

  mode: Mode;
  /** Characters, the meal on the go and plates out, as the server last said. */
  life: LifeState | null;
  menu: Menu | null;
  /** Keep the camera on my character. */
  follow: boolean;
}

export const useGame = create<GameState>(() => ({
  house: null,
  me: null,
  members: [],
  status: "connecting",
  goneReason: "",
  confirmed: null,
  pending: [],
  view: null,
  holds: {},
  presence: {},
  tool: "select",
  wallStyle: "plaster_cream",
  floorMaterial: "oak",
  placing: null,
  selection: null,
  wallMode: "cut",
  canUndo: false,
  canRedo: false,
  catalogOpen: false,
  toasts: [],
  mode: "build",
  life: null,
  menu: null,
  follow: false,
}));

const get = useGame.getState;
const set = useGame.setState;

let conn: Connection | null = null;
let toastSeq = 0;

/** Server clock minus mine. Character positions are worked out from server times. */
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;
function syncClock(now: number) {
  clockOffset = now - Date.now();
}

export function toast(text: string) {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text }] }));
  window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
}

/** Replay pending edits on the confirmed house. Returns the edits that no longer apply. */
function rebase(confirmed: HouseState, pending: Pending[]) {
  let view = confirmed.blueprint;
  const kept: Pending[] = [];
  const dropped: Pending[] = [];
  for (const p of pending) {
    const r = applyOp(view, p.op);
    if (r.ok) {
      view = r.blueprint;
      kept.push(p);
    } else dropped.push(p);
  }
  return { view, kept, dropped };
}

const exists = (bp: Blueprint, id: string) => Boolean(bp.levels[0]?.objects[id] || bp.levels[0]?.openings[id]);

function settle(confirmed: HouseState, pending: Pending[]) {
  const { view, kept, dropped } = rebase(confirmed, pending);
  if (dropped.length) toast("Your partner changed that first.");
  for (const d of dropped) forgetHistory(d.clientOpId);
  const sel = get().selection;
  set({ confirmed, pending: kept, view, selection: sel && exists(view, sel) ? sel : null });
}

function handle(msg: ServerMsg) {
  const s = get();
  switch (msg.type) {
    case "welcome": {
      let confirmed: HouseState;
      let pending = s.pending;
      if (msg.sync.kind === "snapshot") confirmed = msg.sync.state;
      else {
        confirmed = s.confirmed!;
        for (const a of msg.sync.ops) {
          const r = applyOp(confirmed.blueprint, a.op);
          confirmed = { version: a.version, blueprint: r.ok ? r.blueprint : confirmed.blueprint };
          if (a.by === msg.memberId) pending = pending.filter((p) => p.clientOpId !== a.clientOpId);
        }
      }
      syncClock(msg.now);
      set({ me: msg.memberId, members: msg.members, holds: msg.holds, life: msg.life });
      if (s.house) updateHouse(s.house.houseId, { houseName: msg.house.name, inviteCode: msg.house.inviteCode, lastOpened: Date.now() });
      set((st) => ({ house: st.house && { ...st.house, houseName: msg.house.name, inviteCode: msg.house.inviteCode } }));
      settle(confirmed, pending);
      // Anything still pending may or may not have reached the server before we dropped; the server ignores repeats.
      for (const p of get().pending) conn?.send({ type: "op", clientOpId: p.clientOpId, op: p.op });
      // The server forgets holds when it restarts: claim my selection again.
      const sel = get().selection;
      if (sel) conn?.send({ type: "hold", objectId: sel });
      break;
    }
    case "applied": {
      const c = s.confirmed;
      if (!c || msg.version <= c.version) return;
      if (msg.version !== c.version + 1) {
        conn?.resync();
        return;
      }
      const r = applyOp(c.blueprint, msg.op);
      if (!r.ok) {
        // Our copy disagrees with the server's; start over from a fresh snapshot.
        set({ confirmed: { ...c, version: 0 } });
        conn?.resync();
        return;
      }
      settle(
        { version: msg.version, blueprint: r.blueprint },
        s.pending.filter((p) => p.clientOpId !== msg.clientOpId),
      );
      break;
    }
    case "duplicate":
    case "rejected": {
      if (msg.type === "rejected") {
        toast(REJECT_TEXT[msg.reason as keyof typeof REJECT_TEXT] ?? "That didn't work.");
        forgetHistory(msg.clientOpId);
      }
      if (s.confirmed) settle(s.confirmed, s.pending.filter((p) => p.clientOpId !== msg.clientOpId));
      break;
    }
    case "members":
      set({ members: msg.members });
      break;
    case "holds": {
      // If my partner got there first, let go of my selection.
      const lost = s.selection && msg.holds[s.selection] && msg.holds[s.selection] !== s.me;
      set({ holds: msg.holds, ...(lost ? { selection: null } : {}) });
      break;
    }
    case "presence": {
      const { type: _, ...p } = msg;
      set({ presence: { ...s.presence, [p.memberId]: p } });
      break;
    }
    case "error":
      console.warn("[server]", msg.code, msg.message);
      break;
    case "life": {
      syncClock(msg.now);
      // a plate that's been eaten can't keep its menu open
      const menu = s.menu?.dishId && !msg.life.dishes.some((d) => d.id === s.menu!.dishId) ? null : s.menu;
      set({ life: msg.life, menu });
      break;
    }
    case "lifeRejected":
      toast(LIFE_TEXT[msg.reason] ?? "That didn't work.");
      break;
    case "pong":
      syncClock(msg.now);
      break;
  }
}

export function connect(house: SavedHouse) {
  disconnect();
  set({ house, status: "connecting", confirmed: null, pending: [], view: null, holds: {}, presence: {}, selection: null, placing: null, tool: "select", life: null, menu: null });
  undoStack.length = 0;
  redoStack.length = 0;
  set({ canUndo: false, canRedo: false });
  conn = new Connection(house.houseId, house.token, {
    knownVersion: () => get().confirmed?.version ?? 0,
    onMessage: handle,
    // While we're cut off, my partner's cursor and holds are stale; the welcome after reconnecting resends them.
    onStatus: (status) => set(status === "online" ? { status } : { status, presence: {}, holds: {} }),
    onFatal: (code) =>
      set({
        status: "gone",
        goneReason: code === 4409 ? "You opened this house in another tab or device." : code === 4404 ? "This house doesn't exist anymore." : "This browser isn't a member of that house.",
      }),
  });
}

export function disconnect() {
  conn?.dispose();
  conn = null;
}

/**
 * My edits, newest last, each with the op that reverses it. `check` fingerprints what the edit touched right
 * after it, so an undo can tell whether my partner has changed those things since (and then leave them alone).
 */
interface HistoryEntry {
  clientOpId: string;
  forward: Op;
  inverse: Op;
  check: string;
}

const HISTORY = 100;
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

function historyChanged() {
  set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

/** The server turned an edit down (or my partner beat me to it): it can't be undone or redone. */
function forgetHistory(clientOpId: string) {
  for (const stack of [undoStack, redoStack]) {
    const i = stack.findIndex((e) => e.clientOpId === clientOpId);
    if (i >= 0) stack.splice(i, 1);
  }
  historyChanged();
}

/** Make an edit: shown immediately, sent to the server, and undone if the server says no. */
export function submit(op: Op, history: "record" | "undo" | "redo" = "record"): boolean {
  const s = get();
  if (!s.view || !s.confirmed) return false;
  const r = applyOp(s.view, op);
  if (!r.ok) {
    toast(REJECT_TEXT[r.reason]);
    return false;
  }
  const p = { clientOpId: newId(), op };
  const inverse = inverseOp(s.view, op);
  if (inverse) {
    // An undo goes on the redo stack and vice versa; a fresh edit clears the redo stack.
    const entry = { clientOpId: p.clientOpId, forward: op, inverse, check: undoCheck(r.blueprint, op) };
    const stack = history === "undo" ? redoStack : undoStack;
    stack.push(entry);
    if (stack.length > HISTORY) stack.shift();
    if (history === "record") redoStack.length = 0;
    historyChanged();
  }
  set({ pending: [...s.pending, p], view: r.blueprint });
  conn?.send({ type: "op", ...p });
  return true;
}

function stepHistory(from: HistoryEntry[], kind: "undo" | "redo") {
  const view = get().view;
  const e = from.pop();
  historyChanged();
  if (!e || !view) return;
  if (undoCheck(view, e.forward) !== e.check) {
    toast(kind === "undo" ? "Your partner changed that since, so it stays." : "Things changed since, so that can't be redone.");
    return;
  }
  submit(e.inverse, kind);
}

export const undo = () => stepHistory(undoStack, "undo");
export const redo = () => stepHistory(redoStack, "redo");

export function hold(objectId: string | null) {
  conn?.send({ type: "hold", objectId });
}

let lastPresence = "";
let presenceTimer: number | undefined;
let queuedPresence: Omit<Presence, "memberId"> | null = null;

/** Share my cursor and what I'm carrying, at most ~15 times a second and only when it changes. */
export function sharePresence(p: Omit<Presence, "memberId">) {
  const key = JSON.stringify(p);
  if (key === lastPresence) return;
  queuedPresence = p;
  if (presenceTimer !== undefined) return;
  const flush = () => {
    presenceTimer = undefined;
    if (!queuedPresence) return;
    const next = queuedPresence;
    queuedPresence = null;
    lastPresence = JSON.stringify(next);
    conn?.send({ type: "presence", ...next });
    presenceTimer = window.setTimeout(flush, 66);
  };
  flush();
}

/** Who holds an object, if it's someone else. */
export function heldByPartner(objectId: string): MemberInfo | null {
  const s = get();
  const holder = s.holds[objectId];
  if (!holder || holder === s.me) return null;
  return s.members.find((m) => m.id === holder) ?? null;
}

export function setTool(tool: Tool) {
  set({ tool, placing: tool === "buy" ? get().placing : null, selection: tool === "select" ? get().selection : null, catalogOpen: tool === "buy" });
}

/** Ask my character to do something; the server answers with new life (or a reason it can't). */
export function act(intent: LifeIntent) {
  set({ menu: null });
  conn?.send({ type: "life", intent });
}

export function setMode(mode: Mode) {
  if (mode === get().mode) return;
  if (get().selection) hold(null);
  set({ mode, menu: null, selection: null, placing: null, catalogOpen: false, tool: "select", ...(mode === "build" ? { follow: false } : {}) });
}

// Handy for poking at the game from the console while developing.
if (import.meta.env.DEV) Object.assign(window, { __game: useGame, __submit: submit, __undo: undo, __redo: redo, __act: act });
