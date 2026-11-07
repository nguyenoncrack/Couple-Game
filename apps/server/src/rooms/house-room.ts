import {
  applyOp,
  cleanChat,
  CLOSE,
  emptyLife,
  Life,
  newId,
  plausibleDay,
  upgradeBlueprint,
  type AppliedOp,
  type Day,
  type FundsOp,
  type Blueprint,
  type LifeIntent,
  type LifeReject,
  type MemberInfo,
  type Op,
  type Presence,
  type ServerMsg,
  type VisitResult,
  pauseMusic,
  FORT_TEXT,
  PARTY_TEXT,
  type FortCmd,
  type PartyCmd,
} from "@cg/shared";
import type { HouseRow, HouseStore, MemberRow } from "../persistence/store";
import { RateLimiter } from "../rate-limit";
import { errorReason } from "./socket";

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
/** Life changes all the time; save it at most this often. */
const LIFE_SAVE_MS = 2000;
/**
 * With nobody doing anything for this long (a tab left open overnight), everyone is let go, so a house doesn't stay
 * running for nothing. Keep-alive pings don't count. Clients show a "come back" button instead of reconnecting.
 */
export const IDLE_MS = 30 * 60_000;
/** Chat kept per house, and how much of it a player gets when they come in. */
const CHAT_KEEP = 200;
const CHAT_HISTORY = 50;

type Timer = ReturnType<typeof setTimeout>;

/**
 * The authority for one house while anyone is in it. Ops are handled strictly one at a time (a promise queue),
 * so every op is checked against the latest house, written to disk, and only then broadcast with its new version.
 * Rooms share nothing, so houses can't see or affect each other.
 */
/** What a room needs from the directory: its members, and somewhere to count their daily visits. */
export interface RoomDirectory {
  listMembers(): Promise<MemberRow[]>;
  recordVisit(memberId: string, day: Day): Promise<VisitResult | null>;
}

export class HouseRoom {
  private peers = new Set<Peer>();
  /** object or opening ID → memberId currently dragging it. */
  private holds = new Map<string, string>();
  private presence = new Map<string, Presence>();
  /** Per member: a few messages in a row, then one every two seconds. */
  private chatLimit = new RateLimiter(6, 0.5);
  /** The party panel: a slider can send a lot, but not a flood. */
  private partyLimit = new RateLimiter(30, 6);
  private queue: Promise<unknown> = Promise.resolve();
  private members: MemberRow[] = [];
  private snapshotVersion: number;
  /** The day each connection last asked to have counted. */
  private asked = new WeakMap<Peer, Day>();
  /** Life in the house, with free will: characters look after themselves while their player's away or idle. */
  private life = new Life(emptyLife()).enableFreeWill();
  private lifeTimer: Timer | null = null;
  private lifeSave: Timer | null = null;
  private lastActive = 0;
  private idleTimer: Timer | null = null;
  /** How long nobody may do anything before the house closes everyone's connection. */
  private idleMs = IDLE_MS;

  private constructor(
    readonly house: HouseRow,
    private store: HouseStore,
    /** Who's in the house (it can change while the room is open: the partner joins), and their visits. */
    private directory: RoomDirectory,
    private blueprint: Blueprint,
    private version: number,
  ) {
    this.snapshotVersion = version;
  }

  private now() {
    return Date.now();
  }

  /** Load the latest snapshot and replay the log after it. */
  static async load(house: HouseRow, store: HouseStore, directory: RoomDirectory, idleMs = IDLE_MS): Promise<HouseRoom> {
    const snap = await store.loadSnapshot(house.id);
    if (!snap) throw new Error(`house ${house.id} has no snapshot`);
    const room = new HouseRoom(house, store, directory, upgradeBlueprint(snap.blueprint), snap.version);
    room.snapshotVersion = snap.version;
    room.idleMs = idleMs;
    for (;;) {
      const ops = await store.opsSince(house.id, room.version, 1000);
      for (const a of ops) {
        // Logged ops were valid when accepted, so coins never hold them up (they predate prices, or a price changed).
        // If other rules changed since, skip rather than refuse to open the house.
        const r = applyOp(room.blueprint, a.op, undefined, { accepted: true });
        if (r.ok) room.blueprint = r.blueprint;
        else console.warn(`[room ${house.id}] replay skipped v${a.version}: ${r.reason}`);
        room.version = a.version;
      }
      if (ops.length < 1000) break;
    }
    room.members = await directory.listMembers();
    const saved = await store.loadLife(house.id);
    if (saved) {
      room.life = Life.restore(saved, room.now()).enableFreeWill();
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
    return this.members.map((m) => ({ id: m.id, name: m.name, color: m.color, role: m.role, online: online.has(m.id), appearance: m.appearance ?? null }));
  }

  /** Refresh cosmetics through the same queue, without advancing life or blueprint history. */
  refreshAppearance(accountId: string) {
    return this.enqueue(async () => {
      if (!this.members.some((m) => m.accountId === accountId)) return;
      const latest = await this.directory.listMembers();
      // Change only appearance; membership and gameplay are handled by their existing paths.
      this.members = this.members.map((m) => ({ ...m, appearance: latest.find((n) => n.id === m.id)?.appearance ?? null }));
      this.broadcast({ type: "members", members: this.memberInfo() });
    });
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
      this.members = await this.directory.listMembers();

      let sync: Extract<ServerMsg, { type: "welcome" }>["sync"] = { kind: "snapshot", state: this.state };
      const missed = this.version - knownVersion;
      if (knownVersion > 0 && missed >= 0 && missed <= MAX_CATCHUP) {
        const ops = await this.store.opsSince(this.house.id, knownVersion, missed);
        if (ops.length === missed) sync = { kind: "ops", ops };
      }

      const chat = await this.store.recentChat(this.house.id, CHAT_HISTORY);
      this.peers.add(peer);
      const now = this.now();
      // back: their character is theirs again (whatever it's doing carries on until they say otherwise)
      this.life.freeWill?.noteInput(peer.memberId, now);
      const arrived = this.life.ensureAvatar(peer.memberId, this.blueprint, now);
      // back online: a meal they were cooking picks up again, and their needs run again (before the welcome, so
      // they're told as much)
      const changed = this.lifeOnline() || arrived;
      this.touch();
      peer.send({
        type: "welcome",
        memberId: peer.memberId,
        house: { id: this.house.id, name: this.house.name, inviteCode: this.house.inviteCode },
        members: this.memberInfo(),
        holds: this.holdsObject(),
        sync,
        life: this.life.state,
        chat,
        now,
      });
      for (const pr of this.presence.values()) if (pr.memberId !== peer.memberId) peer.send({ type: "presence", ...pr });
      this.broadcast({ type: "members", members: this.memberInfo() }, peer);
      if (changed) this.lifeChanged(peer);
      else this.scheduleLife();
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
    // their character carries on by itself while anyone's here (with nobody left, everything waits)
    if (this.lifeOnline()) this.lifeChanged();
    else this.scheduleLife();
    if (this.peers.size === 0) {
      // the music waits where it was for whoever comes back
      if (pauseMusic(this.life.state, this.now()) && !this.lifeSave) this.lifeSave = setTimeout(() => void this.saveLife(), 0);
      this.stopLife();
    }
  }

  submit(peer: Peer, clientOpId: string, op: Op) {
    return this.enqueue(async () => {
      if (!this.peers.has(peer)) return;
      // A resend after a reconnect: it already happened, just tell the sender.
      if ((await this.store.findClientOp(this.house.id, peer.memberId, clientOpId)) !== null) {
        peer.send({ type: "duplicate", clientOpId });
        return;
      }
      this.life.freeWill?.noteInput(peer.memberId, this.now());
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

  /** Someone came or went: catch life up to now with the new line-up. True if anything changed. */
  private lifeOnline() {
    const now = this.now();
    // time up to now passed with the old line-up, then it changes
    const before = this.life.tick(this.blueprint, now);
    this.life.online = this.online();
    return this.life.tick(this.blueprint, now) || before;
  }

  /** A player did something (not just a keep-alive ping): the house isn't idle. */
  touch() {
    this.lastActive = this.now();
    if (this.idleTimer || !this.peers.size) return;
    const check = () => {
      const left = this.lastActive + this.idleMs - this.now();
      if (!this.peers.size) this.idleTimer = null;
      else if (left > 0) this.idleTimer = setTimeout(check, left);
      else {
        this.idleTimer = null;
        for (const p of [...this.peers]) p.close(CLOSE.idle, "nobody's been here for a while");
      }
    };
    this.idleTimer = setTimeout(check, this.idleMs);
  }

  /** A player asks their character to do something. */
  act(peer: Peer, intent: LifeIntent) {
    if (!this.peers.has(peer)) return;
    this.touch();
    const now = this.now();
    const bp = this.blueprint;
    const id = peer.memberId;
    if (intent.do === "party") return this.party(peer, intent.cmd, now);
    if (intent.do === "fort") return this.fort(peer, intent.id, intent.cmd, now);
    // walking into a wall in first person isn't worth a message; you just don't go anywhere
    let quiet = false;
    // an order: the character is the player's again, and anyone acting on their own makes way
    const r: LifeReject | null = this.life.command(id, bp, now, () => {
      switch (intent.do) {
        case "walk":
          return this.life.walk(id, bp, [intent.x, intent.z], now, intent.level);
        case "ride":
          return this.life.ride(id, bp, intent.objectId, intent.level, now);
        case "use":
          return this.life.use(id, bp, intent.objectId, intent.action, now);
        case "stop":
          return this.life.stop(id, now);
        case "cards":
          return this.life.cards(id, bp, intent.objectId, intent.roundId, intent.action, now);
        case "move": {
          const m = this.life.move(id, bp, [intent.x, intent.z], now);
          quiet = m !== null;
          return m;
        }
        case "cook":
          return this.life.cook(id, bp, intent.recipeId, intent.objectId, now);
        case "help":
          return this.life.help(id, bp, now);
        case "cancel":
          return this.life.cancelCooking();
        case "eat":
          return this.life.eat(id, bp, intent.dishId, now);
        case "fridge":
          return this.life.takeOut(id, bp, intent.leftoverId, intent.objectId, intent.eat, now);
        case "store":
          return this.life.store(bp, intent.dishId, now);
        case "social":
          return this.life.social(id, bp, intent.action, now);
        case "dance":
          return this.life.dance(id, bp, intent.objectId, intent.move, now);
      }
    });
    if (quiet) return;
    if (r) peer.send({ type: "lifeRejected", reason: r });
    else {
      this.life.syncTableGames(bp);
      this.lifeChanged();
    }
  }

  /**
   * A member changes a blanket fort: its pattern, name and sign, or its fairy lights. Like the party panel it's the
   * house's, not an order to their character; the server checks the fort is there, and has lights, if they're asked for.
   */
  private fort(peer: Peer, id: string, cmd: FortCmd, now: number) {
    if (!this.partyLimit.take(peer.memberId)) {
      peer.send({ type: "error", code: "rate-limited", message: "Slow down a little." });
      return;
    }
    this.life.freeWill?.noteInput(peer.memberId, now);
    const { reject, changed } = this.life.fort(this.blueprint, id, cmd);
    if (reject) {
      peer.send({ type: "error", code: reject, message: FORT_TEXT[reject] });
      return;
    }
    if (changed) this.lifeChanged();
  }

  /**
   * A member works the party panel: lights, or the shared music. It's the house's, not an order to their character,
   * so it doesn't take over what they're doing; the server checks the house has the gear and keeps the queue sane.
   */
  private party(peer: Peer, cmd: PartyCmd, now: number) {
    if (!this.partyLimit.take(peer.memberId)) {
      peer.send({ type: "error", code: "rate-limited", message: "Slow down a little." });
      return;
    }
    this.life.freeWill?.noteInput(peer.memberId, now);
    const { reject, changed } = this.life.party(peer.memberId, this.blueprint, cmd, now);
    if (reject) {
      peer.send({ type: "error", code: reject, message: PARTY_TEXT[reject] });
      return;
    }
    if (changed) this.lifeChanged();
  }

  /**
   * A player is here today (their own calendar day, sent once they've done something). The first time that day the
   * directory counts it and the house gets its coins, logged like an edit so the funds replay with everything
   * else; any other time they're just told it's already counted. A day is only asked about once per connection.
   */
  visit(peer: Peer, day: Day) {
    if (!this.peers.has(peer) || this.asked.get(peer) === day || !plausibleDay(day, this.now())) return;
    this.asked.set(peer, day);
    return this.enqueue(async () => {
      const visit = await this.directory.recordVisit(peer.memberId, day);
      if (visit) await this.logFunds(peer.memberId, visit);
      peer.send({ type: "visit", visit });
    });
  }

  /** The coins a visit brings, into the house's log and to everyone. */
  private async logFunds(memberId: string, visit: VisitResult) {
    const op: FundsOp = { t: "funds.add", amount: visit.coins, note: `visit ${visit.day}` };
    const r = applyOp(this.blueprint, op, undefined, { accepted: true });
    if (!r.ok) return;
    const applied: AppliedOp = { version: this.version + 1, op, by: memberId, clientOpId: `visit-${visit.day}` };
    try {
      await this.store.appendOp(this.house.id, applied);
    } catch (e) {
      // the day is counted but the coins didn't land; nothing else to undo
      console.error(`[room ${this.house.id}] failed to save visit coins`, e);
      return;
    }
    this.blueprint = r.blueprint;
    this.version = applied.version;
    this.broadcast({ type: "applied", ...applied });
    if (this.version - this.snapshotVersion >= SNAPSHOT_EVERY) await this.snapshot();
  }

  /** Say something to the house: kept with it, and sent to everyone (the speaker too, so both show the same). */
  say(peer: Peer, text: string) {
    if (!this.peers.has(peer)) return;
    const clean = cleanChat(text);
    if (!clean) return;
    if (!this.chatLimit.take(peer.memberId)) {
      peer.send({ type: "error", code: "rate-limited", message: "Slow down a little." });
      return;
    }
    this.touch();
    this.life.freeWill?.noteInput(peer.memberId, this.now());
    const message = { id: newId(12), by: peer.memberId, text: clean, at: this.now() };
    return this.enqueue(async () => {
      await this.store.appendChat(this.house.id, message, CHAT_KEEP);
      this.broadcast({ type: "chat", message });
    });
  }

  /** Tell everyone (or everyone but one, who already has it), save soon, and wait for whatever's next. */
  private lifeChanged(except?: Peer) {
    this.broadcast({ type: "life", life: this.life.state, now: this.now() }, except);
    if (!this.lifeSave) this.lifeSave = setTimeout(() => void this.saveLife(), LIFE_SAVE_MS);
    this.scheduleLife();
  }

  /** Sleep until the next thing that can happen in the house (a step done, a bite finished), then deal with it. */
  private scheduleLife() {
    if (this.lifeTimer) clearTimeout(this.lifeTimer);
    this.lifeTimer = null;
    if (!this.peers.size) return;
    const at = this.life.nextEvent(this.now());
    if (at === null) return;
    this.lifeTimer = setTimeout(
      () => {
        this.lifeTimer = null;
        try {
          if (this.life.tick(this.blueprint, this.now())) this.lifeChanged();
          else this.scheduleLife();
        } catch (e) {
          // nobody's message to blame: say so to everyone, rather than take the whole house down with it
          console.error(`[room ${this.house.id}] life tick failed`, e instanceof Error ? e.stack : e);
          this.broadcast({ type: "error", code: "server", message: errorReason(e) });
        }
      },
      at - this.now() + 5,
    );
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

  /** Nobody's left: stop the clock and save where everything is. */
  private stopLife() {
    if (this.lifeTimer) clearTimeout(this.lifeTimer);
    this.lifeTimer = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.lifeSave) void this.saveLife();
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
    this.lifeOnline();
    this.stopLife();
  }
}
