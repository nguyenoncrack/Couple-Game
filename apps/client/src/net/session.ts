/**
 * Houses this browser belongs to, with the secret token for each. Kept in localStorage; if storage is blocked
 * (private mode), the game still works for the current visit.
 */

export interface SavedHouse {
  houseId: string;
  houseName: string;
  memberId: string;
  token: string;
  inviteCode: string;
  /** Last version this browser saw, so a reload only needs the edits it missed. */
  knownVersion?: number;
  lastOpened: number;
}

const KEY = "cg.houses.v1";
let memory: Record<string, SavedHouse> = {};

function readAll(): Record<string, SavedHouse> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, SavedHouse>) : memory;
  } catch {
    return memory;
  }
}

function writeAll(all: Record<string, SavedHouse>) {
  memory = all;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: keep it in memory for this visit
  }
}

export function savedHouses(): SavedHouse[] {
  return Object.values(readAll()).sort((a, b) => b.lastOpened - a.lastOpened);
}

export function savedHouse(houseId: string): SavedHouse | null {
  return readAll()[houseId] ?? null;
}

export function saveHouse(h: SavedHouse) {
  writeAll({ ...readAll(), [h.houseId]: h });
}

export function updateHouse(houseId: string, patch: Partial<SavedHouse>) {
  const all = readAll();
  const h = all[houseId];
  if (h) writeAll({ ...all, [houseId]: { ...h, ...patch } });
}

export function forgetHouse(houseId: string) {
  const all = readAll();
  delete all[houseId];
  writeAll(all);
}

/** The name you last played under, to prefill forms. */
export function lastPlayerName(): string {
  try {
    return localStorage.getItem("cg.name") ?? "";
  } catch {
    return "";
  }
}

export function rememberPlayerName(name: string) {
  try {
    localStorage.setItem("cg.name", name);
  } catch {
    // fine
  }
}
