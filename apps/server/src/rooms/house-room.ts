import {
  applyOp,
  CLOSE,
  emptyLife,
  Life,
  upgradeBlueprint,
  type AppliedOp,
  type Blueprint,
  type LifeIntent,
  type LifeReject,
  type MemberInfo,
  type Op,
  type Presence,
  type ServerMsg,
} from "@cg/shared";
import type { HouseRow, MemberRow, Store } from "../persistence/store";

/** The object, door or window with this ID, if it exists. */
function find(bp: Blueprint, id: string) {
  for (const l of bp.levels) {
    const it = l.objects[id] ?? l.openings[id];
    if (it) return it;
  }
  return undefined;
}

/** One connected browser tab. */
export interface Peer {
  memberId: string;
  send(msg: ServerMsg): void;
  close(code: number, reason: string): void;
}

/** Send missed ops on reconnect up to this many; beyond that a snapshot is smaller and simpler. */
const MAX_CATCHUP = 500;
/** Write a fresh snapshot after this many ops, and keep this many ops of history behind it. */
const SNAPSHOT_EVERY = 100;
const KEEP_HISTORY = 1000;
/** How often time moves on for meals and plates while someone's in. */
const LIFE_TICK_MS = 250;
/** Life changes all the time; save it at most this often. */
const LIFE_SAVE_MS = 2000;

/**
 * The authority for one house while anyone is in it. Ops are handled strictly one at a time (a promise queue),
 * so every op is checked against the latest house, written to disk, and only then broadcast with its new version.
 * Rooms share nothing, so houses can't see or affect each other.
 */
export class HouseRoom {
  private peers = new Set<Peer>();
  /** object or opening ID → memberId currently dragging it. */
  private holds = new Map<string, string>();
  private presence = new Map<string, Presence>();
  private queue: Promise<unknown> = Promise.resolve();
  private members: MemberRow[] = [];
  private snapshotVersion: number;
  private life = new Life(emptyLife());
  private lifeTimer: NodeJS.Timeout | null = null;
  private lifeSave: NodeJS.Timeout | null = null;

  private constructor(
    readonly house: HouseRow,
    private store: Store,
    private blueprint: Blueprint,
    private version: number,
  ) {
    this.snapshotVersion = version;
  }

  private now() {
    return Date.now();
  }

  /** Load the latest snapshot and replay the log after it. */
  static async load(house: HouseRow, store: Store): Promise<HouseRoom> {
    const snap = await store.loadSnapshot(house.id);
    if (!snap) throw new Error(`house ${house.id} has no snapshot`);
    const room = new HouseRoom(house, store, upgradeBlueprint(snap.blueprint), snap.version);
    room.snapshotVersion = snap.version;
    for (;;) {
      const ops = await store.opsSince(house.id, room.version, 1000);
      for (const a of ops) {
        const r = applyOp(room.blueprint, a.op);
        // Logged ops were valid when accepted; if the rules changed since, skip rather than refuse to open the house.
        if (r.ok) room.blueprint = r.blueprint;
        else console.warn(`[room ${house.id}] replay skipped v${a.version}: ${r.reason}`);
        room.version = a.version;
      }
      if (ops.length < 1000) break;
    }
    room.members = await store.listMembers(house.id);
    const saved = await store.loadLife(house.id);
    if (saved) {
      room.life = Life.restore(saved, room.now());
      room.life.onBlueprint(room.blueprint, room.now());
    }
    return room;
  }

  get isEmpty() {
    return this.peers.size === 0;
  }

  get state() {
    return { version: this.version, blueprint: this.blueprint };
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private memberInfo(): MemberInfo[] {
    const online = new Set([...this.peers].map((p) => p.memberId));
    return this.members.map((m) => ({ id: m.id, name: m.name, color: m.color, role: m.role, online: online.has(m.id) }));
  }

  private broadcast(msg: ServerMsg, except?: Peer) {
    for (const p of this.peers) if (p !== except) p.send(msg);
  }

  private holdsObject() {
    return Object.fromEntries(this.holds);
  }

  join(peer: Peer, knownVersion: number) {
    return this.enqueue(async () => {
      // One live connection per member: a new tab or device takes over from the old one.
      for (const p of this.peers) {
        if (p.memberId === peer.memberId) {
          this.peers.delete(p);
          p.close(CLOSE.replaced, "opened somewhere else");
        }
      }
      this.members = await this.store.listMembers(this.house.id);

      let sync: Extract<ServerMsg, { type: "welcome" }>["sync"] = { kind: "snapshot", state: this.state };
      const missed = this.version - knownVersion;
      if (knownVersion > 0 && missed >= 0 && missed <= MAX_CATCHUP) {
        const ops = await this.store.opsSince(this.house.id, knownVersion, missed);
        if (ops.length === missed) sync = { kind: "ops", ops };
      }

      this.peers.add(peer);
      const now = this.now();
      const arrived = this.life.ensureAvatar(peer.memberId, this.blueprint, now);
      this.life.online = this.online();
      this.startLife();
      peer.send({
        type: "welcome",
        memberId: peer.memberId,
        house: { id: this.house.id, name: this.house.name, inviteCode: this.house.inviteCode },
        members: this.memberInfo(),
        holds: this.holdsObject(),
        sync,
        life: this.life.state,
        now,
      });
      for (const pr of this.presence.values()) if (pr.memberId !== peer.memberId) peer.send({ type: "presence", ...pr });
      this.broadcast({ type: "members", members: this.memberInfo() }, peer);
      if (arrived) this.lifeChanged(peer);
    });
  }

  leave(peer: Peer) {
    if (!this.peers.delete(peer)) return;
    if ([...this.peers].some((p) => p.memberId === peer.memberId)) return;
    let released = false;
    for (const [obj, m] of this.holds) if (m === peer.memberId) released = this.holds.delete(obj);
    if (released) this.broadcast({ type: "holds", holds: this.holdsObject() });
    if (this.presence.delete(peer.memberId)) this.broadcast({ type: "presence", memberId: peer.memberId, cursor: null, tool: "", drag: null });
    this.broadcast({ type: "members", members: this.memberInfo() });
    this.life.online = this.online();
    if (this.peers.size === 0) this.stopLife();
  }

  submit(peer: Peer, clientOpId: string, op: Op) {
    return this.enqueue(async () => {
      if (!this.peers.has(peer)) return;
      // A resend after a reconnect: it already happened, just tell the sender.
      if ((await this.store.findClientOp(this.house.id, peer.memberId, clientOpId)) !== null) {
        peer.send({ type: "duplicate", clientOpId });
        return;
      }
      const r = applyOp(this.blueprint, op);
      if (!r.ok) {
        peer.send({ type: "rejected", clientOpId, reason: r.reason });
        return;
      }
      // Hands off anything the partner is holding, however the edit reaches it (a move, a batch, or knocking down
      // the wall a door is in). Edits share everything they don't change, so a changed item is a different object.
      const after = r.blueprint;
      for (const [id, holder] of this.holds) {
        if (holder !== peer.memberId && find(this.blueprint, id) !== find(after, id)) {
          peer.send({ type: "rejected", clientOpId, reason: "held" });
          return;
        }
      }
      const applied: AppliedOp = { version: this.version + 1, op, by: peer.memberId, clientOpId };
      // Saved before anyone hears about it. If the write fails, the op never happened.
      try {
        await this.store.appendOp(this.house.id, applied);
      } catch (e) {
        console.error(`[room ${this.house.id}] failed to save op`, e);
        peer.send({ type: "rejected", clientOpId, reason: "invalid" });
        return;
      }
      this.blueprint = r.blueprint;
      this.version = applied.version;
      this.broadcast({ type: "applied", ...applied });
      // Anyone sitting on a chair that just went stands up, walks re-route round new furniture, and so on.
      if (this.life.onBlueprint(this.blueprint, this.now())) this.lifeChanged();

      // Anything that no longer exists can't be held (removing a wall also removes its doors and windows).
      let released = false;
      for (const id of this.holds.keys()) if (!this.exists(id)) released = this.holds.delete(id) || released;
      if (released) this.broadcast({ type: "holds", holds: this.holdsObject() });
      if (this.version - this.snapshotVersion >= SNAPSHOT_EVERY) await this.snapshot();
    });
  }

  hold(peer: Peer, objectId: string | null) {
    const before = JSON.stringify(this.holdsObject());
    for (const [obj, m] of this.holds) if (m === peer.memberId && obj !== objectId) this.holds.delete(obj);
    if (objectId && !this.holds.has(objectId) && this.exists(objectId)) this.holds.set(objectId, peer.memberId);
    // Always answer the asker (it may have lost a race), and tell everyone if anything changed.
    if (JSON.stringify(this.holdsObject()) !== before) this.broadcast({ type: "holds", holds: this.holdsObject() });
    else peer.send({ type: "holds", holds: this.holdsObject() });
  }

  private exists(id: string) {
    return find(this.blueprint, id) !== undefined;
  }

  setPresence(peer: Peer, p: Omit<Presence, "memberId">) {
    const pr: Presence = { memberId: peer.memberId, ...p };
    this.presence.set(peer.memberId, pr);
    this.broadcast({ type: "presence", ...pr }, peer);
  }

  // --- life in the house ---

  private online() {
    return new Set([...this.peers].map((p) => p.memberId));
  }

  /** A player asks their character to do something. */
  act(peer: Peer, intent: LifeIntent) {
    if (!this.peers.has(peer)) return;
    const now = this.now();
    const bp = this.blueprint;
    const id = peer.memberId;
    let r: LifeReject | null;
    switch (intent.do) {
      case "walk":
        r = this.life.walk(id, bp, [intent.x, intent.z], now);
        break;
      case "use":
        r = this.life.use(id, bp, intent.objectId, intent.action, now);
        break;
      case "stop":
        r = this.life.stop(id, now);
        break;
      case "cook":
        r = this.life.cook(id, bp, intent.recipeId, intent.objectId, now);
        break;
      case "help":
        r = this.life.help(id, bp, now);
        break;
      case "cancel":
        r = this.life.cancelCooking();
        break;
      case "eat":
        r = this.life.eat(id, bp, intent.dishId, now);
        break;
    }
    if (r) peer.send({ type: "lifeRejected", reason: r });
    else this.lifeChanged();
  }

  /** Tell everyone (or everyone but one, who already has it) and save soon. */
  private lifeChanged(except?: Peer) {
    this.broadcast({ type: "life", life: this.life.state, now: this.now() }, except);
    if (!this.lifeSave) this.lifeSave = setTimeout(() => void this.saveLife(), LIFE_SAVE_MS);
  }

  private async saveLife() {
    if (this.lifeSave) clearTimeout(this.lifeSave);
    this.lifeSave = null;
    try {
      await this.store.saveLife(this.house.id, this.life.saved(this.now()));
    } catch (e) {
      console.error(`[room ${this.house.id}] failed to save life`, e);
    }
  }

  private startLife() {
    this.lifeTimer ??= setInterval(() => {
      if (this.life.tick(this.blueprint, this.now())) this.lifeChanged();
    }, LIFE_TICK_MS);
  }

  private stopLife() {
    if (this.lifeTimer) clearInterval(this.lifeTimer);
    this.lifeTimer = null;
    // one last look with nobody online, so a meal on the go stops where it is
    this.life.online = this.online();
    if (this.life.tick(this.blueprint, this.now()) || this.lifeSave) void this.saveLife();
  }

  /** Write a snapshot if anything changed since the last one, and trim old history. Call only from the queue. */
  private async snapshot() {
    if (this.version === this.snapshotVersion) return;
    const version = this.version;
    await this.store.saveSnapshot(this.house.id, { version, blueprint: this.blueprint });
    this.snapshotVersion = version;
    if (version > KEEP_HISTORY) await this.store.pruneOps(this.house.id, version - KEEP_HISTORY);
  }

  /** Snapshot after any ops still in the queue (before unloading or shutting down). */
  flush() {
    return this.enqueue(async () => {
      await this.snapshot();
      await this.saveLife();
    });
  }

  /** Close every connection (server shutdown). */
  closeAll(code: number, reason: string) {
    for (const p of this.peers) p.close(code, reason);
    this.peers.clear();
    this.stopLife();
  }
}
