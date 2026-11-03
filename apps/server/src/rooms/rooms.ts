import type { Store } from "../persistence/store";
import { HouseRoom } from "./house-room";

/**
 * Keeps a room in memory for each house someone is in. A room loads on the first join and unloads (after a
 * snapshot) once it has been empty for a little while, so many houses can exist with only the active ones in memory.
 */
export class Rooms {
  private rooms = new Map<string, Promise<HouseRoom>>();
  private idle = new Map<string, NodeJS.Timeout>();
  /** When each house was last asked for; an unload that started before this is abandoned. */
  private lastGet = new Map<string, number>();

  constructor(
    private store: Store,
    private idleMs = 30_000,
  ) {}

  async get(houseId: string): Promise<HouseRoom | null> {
    this.lastGet.set(houseId, performance.now());
    this.cancelUnload(houseId);
    let room = this.rooms.get(houseId);
    if (!room) {
      const house = await this.store.getHouse(houseId);
      if (!house) return null;
      // Re-check: another connection may have started loading while we looked the house up.
      room = this.rooms.get(houseId) ?? HouseRoom.load(house, this.store);
      this.rooms.set(houseId, room);
      room.catch(() => this.rooms.delete(houseId));
    }
    return room;
  }

  /** Call when a peer leaves; schedules an unload if the room is now empty. */
  async released(houseId: string) {
    const room = await this.rooms.get(houseId);
    if (!room?.isEmpty) return;
    this.cancelUnload(houseId);
    this.idle.set(
      houseId,
      setTimeout(async () => {
        this.idle.delete(houseId);
        const started = performance.now();
        if (!room.isEmpty) return;
        await room.flush();
        // Someone may have fetched the room (and be about to join) while it was saving: keep it then.
        if (room.isEmpty && (this.lastGet.get(houseId) ?? 0) < started) {
          this.rooms.delete(houseId);
          this.lastGet.delete(houseId);
        }
      }, this.idleMs),
    );
  }

  private cancelUnload(houseId: string) {
    const t = this.idle.get(houseId);
    if (t) clearTimeout(t);
    this.idle.delete(houseId);
  }

  /** Snapshot every loaded house (on shutdown). */
  async flushAll() {
    for (const t of this.idle.values()) clearTimeout(t);
    this.idle.clear();
    for (const r of this.rooms.values()) await (await r).flush();
  }

  get loaded() {
    return this.rooms.size;
  }
}
