import { DEFAULT_BPM, isRecording, PHRASE_BEATS, RECORDED_TRACKS, sectionAt, type DeckTrackId } from "@cg/shared";
import { create } from "zustand";
import { RECORDING_URLS, STREAMED_RECORDINGS } from "../recordings";
import { hitAt, LAYERS, TRACK_DEFS } from "../tracks";
import { Listener, WAVE_RATE, type Analysis } from "./analyze";

/**
 * Every record's waveform, tempo, beats and energy, on this device.
 *
 * A recording is listened to the first time it's seen, in the background (it plays as usual meanwhile), and the result
 * is kept in IndexedDB under the record and its audio version (the file's ETag, or its size and date), so a record
 * whose audio is replaced is listened to again. A new record added to the deck is picked up the same way, with
 * nothing to set up. The built-in records are made from patterns, so theirs is worked out from the pattern.
 */

export type AnalysisState = { status: "analyzing"; progress: number } | { status: "ready"; analysis: Analysis; version: string } | { status: "error" };

export const useAnalysis = create<Partial<Record<DeckTrackId, AnalysisState>>>(() => ({}));

/** The analysis of a record, if it's ready. */
export const readyAnalysis = (s: AnalysisState | undefined): Analysis | null => (s?.status === "ready" ? s.analysis : null);

const RATE = 11025;
/** (bump to listen to every record again after a change in how it's done) */
const METHOD = 2;
const queue: DeckTrackId[] = [];
let running = false;

/** Ask for a record's analysis: soon, or first in line with `urgent` (a record on a deck). */
export function requestAnalysis(id: DeckTrackId | null, urgent = false) {
  if (!id) return;
  const state = useAnalysis.getState()[id];
  if (state?.status === "ready" || state?.status === "error") return;
  if (!isRecording(id)) {
    useAnalysis.setState({ [id]: { status: "ready", analysis: patternAnalysis(id), version: `pattern-${METHOD}` } });
    return;
  }
  const at = queue.indexOf(id);
  if (at >= 0) {
    if (!urgent) return;
    queue.splice(at, 1);
  }
  if (urgent) queue.unshift(id);
  else queue.push(id);
  void pump();
}

/** Look again at a record (its audio may have been replaced since). */
export function forgetAnalysis(id: DeckTrackId) {
  useAnalysis.setState({ [id]: undefined });
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await analyzeRecording(id);
      } catch {
        useAnalysis.setState({ [id]: { status: "error" } });
      }
    }
  } finally {
    running = false;
  }
}

/**
 * The audio's version, from the server: its ETag, or else its size and date. Asked with a one-byte range, which
 * also gives the file's full size (a HEAD doesn't always say it).
 */
async function audioVersion(url: string): Promise<{ version: string; size: number | null }> {
  const res = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-cache" });
  if (!res.ok) throw new Error(`no audio at ${url}`);
  const total = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  const size = Number(total ?? (res.status === 200 ? res.headers.get("content-length") : null)) || null;
  // (a server that ignores the range sends the whole file: no need to wait for it)
  void res.body?.cancel().catch(() => {});
  const tag = res.headers.get("etag") ?? `${size ?? "?"}-${res.headers.get("last-modified") ?? "?"}`;
  return { version: `${METHOD}:${tag}`, size };
}

async function analyzeRecording(id: DeckTrackId) {
  const url = RECORDING_URLS[id];
  if (!url) throw new Error("no audio");
  const { version, size } = await audioVersion(url);
  const key = `${id}@${version}`;
  const cached = await cacheGet(key);
  if (cached) {
    useAnalysis.setState({ [id]: { status: "ready", analysis: cached, version } });
    return;
  }
  useAnalysis.setState({ [id]: { status: "analyzing", progress: 0 } });
  // (yields between pieces, so the game stays smooth)
  const rest = () => new Promise((r) => setTimeout(r, 0));
  const decoder = new OfflineAudioContext(1, 1, RATE);
  const known = RECORDED_TRACKS.find((t) => t.id === id)?.seconds ?? 0;
  let listener: Listener;
  if (STREAMED_RECORDINGS.has(id) && size) {
    // a long set, piece by piece: each piece goes where its bytes are in the file
    listener = new Listener(RATE, known);
    const piece = 1_500_000;
    for (let from = 0; from < size; from += piece) {
      const to = Math.min(size, from + piece) - 1;
      const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
      const bytes = await res.arrayBuffer();
      try {
        const audio = await decoder.decodeAudioData(bytes);
        listener.push(mono(audio), (from / size) * known);
      } catch {
        // a piece that won't decode is left quiet
      }
      useAnalysis.setState({ [id]: { status: "analyzing", progress: to / size } });
      await rest();
    }
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`no audio at ${url}`);
    const audio = await decoder.decodeAudioData(await res.arrayBuffer());
    listener = new Listener(RATE, audio.duration);
    const samples = mono(audio);
    const piece = RATE * 30;
    for (let i = 0; i < samples.length; i += piece) {
      listener.push(samples.subarray(i, i + piece), i / RATE);
      useAnalysis.setState({ [id]: { status: "analyzing", progress: Math.min(0.95, i / samples.length) } });
      await rest();
    }
  }
  const analysis = listener.finish();
  await cachePut(key, analysis);
  useAnalysis.setState({ [id]: { status: "ready", analysis, version } });
}

function mono(audio: AudioBuffer): Float32Array {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i]! += ch[i]! / audio.numberOfChannels;
  }
  return out;
}

/**
 * A built-in record's analysis, from its pattern: it keeps the deck's tempo exactly, its beats start at zero, and its
 * loudness follows the parts of its 32-bar phrase (the kick drawn on each beat it plays).
 */
export function patternAnalysis(id: DeckTrackId): Analysis {
  const def = TRACK_DEFS[id as keyof typeof TRACK_DEFS];
  const duration = (PHRASE_BEATS * 60) / DEFAULT_BPM;
  const cols = Math.ceil(duration * WAVE_RATE) + 1;
  const peaks = new Uint8Array(cols);
  const lows = new Uint8Array(cols);
  for (let c = 0; c < cols; c++) {
    const beat = ((c / WAVE_RATE) * DEFAULT_BPM) / 60;
    const L = LAYERS[sectionAt(beat, null)];
    const step = Math.floor(beat * 4);
    const since = beat * 4 - step;
    const kick = def ? hitAt(def.kick, step) * L.kick * Math.exp(-since * 2.5) : 0;
    const bed = 0.18 * L.hat + 0.2 * L.pad + 0.2 * L.lead + 0.22 * L.bass + 0.15 * L.clap;
    const level = Math.min(1, bed + 0.55 * kick);
    peaks[c] = Math.round(Math.sqrt(level) * 255);
    lows[c] = Math.round(Math.min(1, (0.8 * kick + 0.3 * L.bass) / Math.max(0.05, level)) * 200);
  }
  const secs = Math.ceil(duration);
  const energy = new Uint8Array(secs);
  for (let s = 0; s < secs; s++) {
    const L = LAYERS[sectionAt(((s + 0.5) * DEFAULT_BPM) / 60, null)];
    energy[s] = Math.round(Math.min(1, (L.kick + L.bass + L.clap + L.hat + L.pad + L.lead) / 5.5) * 255);
  }
  return { duration, peaks, lows, bpm: DEFAULT_BPM, beat: 0, downbeat: 0, confidence: 1, reliable: true, energy };
}

// ---- the cache: IndexedDB, one entry per record and audio version

let db: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open("cg-dj", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("analysis");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

async function cacheGet(key: string): Promise<Analysis | null> {
  const d = await openDb();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction("analysis").objectStore("analysis").get(key);
      req.onsuccess = () => resolve((req.result as Analysis | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePut(key: string, a: Analysis): Promise<void> {
  const d = await openDb();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction("analysis", "readwrite");
      const store = tx.objectStore("analysis");
      // an older version of the same record goes
      const id = key.slice(0, key.indexOf("@") + 1);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const k of keys.result) if (typeof k === "string" && k.startsWith(id) && k !== key) store.delete(k);
        store.put(a, key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// (a handle for poking at it from the browser's console while developing)
if (import.meta.env.DEV && typeof window !== "undefined") Object.assign(window, { __analysis: useAnalysis });
