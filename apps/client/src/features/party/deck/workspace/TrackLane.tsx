import { DEFAULT_BPM, deckTrack, isRecording, trackBeats, type DeckTrackId } from "@cg/shared";
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Analysis } from "../analysis/analyze";
import { readyAnalysis, type AnalysisState } from "../analysis/trackAnalysis";
import { preciseClock, secondsToBeats } from "../deckTime";
import { previewPosition } from "../preview";

/**
 * One record of the pair you're working on, as a waveform: its beats and bars (when it has a steady beat), its cue
 * points, the transition's point on it (where it fades, or where it comes in) with the overlap shaded, where the
 * live deck is if it's playing it, and where your private preview has got to. Click or drag to move the point.
 */

const toSeconds = (beats: number) => (beats * 60) / DEFAULT_BPM;

export interface LaneProps {
  id: DeckTrackId;
  /** The record's number in the set (1 for the first). */
  num: number;
  role: "out" | "into";
  selected: boolean;
  state: AnalysisState | undefined;
  zoom: number;
  onPoints: boolean;
  /** The transition's point on this record (unsaved or saved), and the saved one. */
  point: number | null;
  saved: number | null;
  /** The overlap, in track beats. */
  span: number;
  /** Where the live deck is in this record, when this record is the one on a deck. */
  live: (() => number | null) | null;
  cues: number[];
  setPoint: (p: number) => void;
  onSelect: () => void;
}

export function TrackLane(props: LaneProps) {
  const { id, num, role, state, point, selected } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  /** While dragging: the view, held still. */
  const drag = useRef<[number, number] | null>(null);
  const lastView = useRef<[number, number]>([0, 1]);
  const clock = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const p = latest.current;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      if (!g || !w) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const len = trackBeats(p.id);
      const live = p.live?.() ?? null;
      const preview = previewPosition(p.role, p.id);
      const center = p.onPoints && p.point !== null ? p.point + (p.role === "out" ? p.span / 2 : 0) : (preview ?? live ?? p.point ?? 0);
      const view = drag.current ?? viewOf(len, p.zoom, center);
      lastView.current = view;
      draw(g, w, h, { len, a: readyAnalysis(p.state), progress: p.state?.status === "analyzing" ? p.state.progress : null, view, pos: live, preview, color: deckTrack(p.id).color, cues: p.cues, point: p.point, saved: p.saved, role: p.role, span: p.span });
      if (clock.current) clock.current.textContent = live !== null ? `Live ${preciseClock(live)} / ${preciseClock(len)}` : preview !== null ? `Rehearsing ${preciseClock(preview)}` : preciseClock(len);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  const len = trackBeats(id);
  const a = readyAnalysis(state);
  const at = (e: PointerEvent<HTMLCanvasElement>, view: [number, number]) => {
    const r = e.currentTarget.getBoundingClientRect();
    const b = view[0] + ((e.clientX - r.left) / r.width) * (view[1] - view[0]);
    return Math.max(0, Math.min(len - 0.01, e.shiftKey ? b : snap(a, b)));
  };
  const key = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const by = isRecording(id) ? secondsToBeats(e.shiftKey ? 0.1 : 1) : e.shiftKey ? 1 : 4;
    const step = e.key === "ArrowRight" ? by : e.key === "ArrowLeft" ? -by : null;
    if (step === null) return;
    e.preventDefault();
    props.setPoint(Math.max(0, Math.min(len - 0.01, (point ?? 0) + step)));
  };
  const t = deckTrack(id);
  const what = role === "out" ? "fades out" : "comes in";
  return (
    <div className={`dj-lane ${role} ${selected ? "is-selected" : ""}`} style={{ "--c": t.color } as CSSProperties}>
      <div className="dj-lane-head">
        <button className="dj-lane-pick" onClick={props.onSelect} aria-pressed={selected} title="Select this record">
          <b>Track {num}</b>
        </button>
        <span className="dj-lane-role">{what}</span>
        <span className="dj-lane-name">{t.name}</span>
        <span className={`dj-lane-info ${state?.status ?? "analyzing"}`}>{analysisText(id, state)}</span>
        <span ref={clock} className="dj-lane-clock" />
      </div>
      <canvas
        ref={canvas}
        className="dj-wave"
        tabIndex={0}
        role="slider"
        aria-label={`Track ${num}, ${t.name}: where it ${role === "out" ? "starts fading" : "starts"}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(toSeconds(len))}
        aria-valuenow={Math.round(toSeconds(point ?? 0))}
        aria-valuetext={point === null ? "not set" : preciseClock(point)}
        onKeyDown={key}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = lastView.current;
          props.setPoint(at(e, drag.current));
        }}
        onPointerMove={(e) => {
          if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) props.setPoint(at(e, drag.current));
        }}
        onPointerUp={() => (drag.current = null)}
        onLostPointerCapture={() => (drag.current = null)}
      />
    </div>
  );
}

/** A record's analysis, as a line: its tempo and how sure, or how far it has got. */
function analysisText(id: DeckTrackId, state: AnalysisState | undefined): string {
  if (!state || state.status === "analyzing") return `Analyzing…${state?.status === "analyzing" && state.progress > 0.02 ? ` ${Math.round(state.progress * 100)}%` : ""}`;
  if (state.status === "error") return "Couldn't analyze (it still plays)";
  const a = state.analysis;
  if (!isRecording(id)) return `${DEFAULT_BPM} BPM · built-in`;
  return a.reliable ? `${a.bpm.toFixed(1)} BPM · beat grid` : `~${Math.round(a.bpm)} BPM · no steady grid`;
}

/** The part of a record a waveform shows, centred on `center` where it can be. */
export function viewOf(len: number, zoom: number, center: number): [number, number] {
  const span = Math.max(4, len / zoom);
  if (span >= len) return [0, len];
  const from = Math.max(0, Math.min(len - span, center - span / 2));
  return [from, from + span];
}

/** The nearest beat to a place (track beats), when the record has a steady one. */
export function snap(a: Analysis | null, b: number): number {
  if (!a?.reliable) return b;
  const p = 60 / a.bpm;
  const s = toSeconds(b);
  const k = Math.round((s - a.beat) / p);
  const t = a.beat + k * p;
  return t < 0 ? b : Math.round(secondsToBeats(t) * 1000) / 1000;
}

interface DrawWhat {
  len: number;
  a: Analysis | null;
  progress: number | null;
  view: [number, number];
  /** The live deck's place in this record, if it's playing it. */
  pos: number | null;
  preview: number | null;
  color: string;
  cues: number[];
  point: number | null;
  saved: number | null;
  role: "out" | "into";
  span: number;
}

const TICKS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

function clockLabel(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.abs(r - Math.round(r)) < 1e-6;
  return `${m}:${(whole ? String(Math.round(r)) : r.toFixed(1)).padStart(whole ? 2 : 4, "0")}`;
}

function draw(g: CanvasRenderingContext2D, w: number, h: number, o: DrawWhat) {
  const [v0, v1] = o.view;
  const x = (b: number) => ((b - v0) / (v1 - v0)) * w;
  const mid = (h - 14) / 2;
  const top = 2;
  // the overlap
  if (o.point !== null) {
    const x0 = x(o.point);
    const x1 = x(o.point + o.span);
    g.fillStyle = o.role === "out" ? "rgba(255, 176, 46, 0.18)" : "rgba(141, 255, 58, 0.14)";
    g.fillRect(x0, 0, x1 - x0, h - 14);
  }
  // bars and phrases, when the beat is steady
  const a = o.a;
  if (a?.reliable) {
    const beatB = secondsToBeats(60 / a.bpm);
    const perBeat = w / ((v1 - v0) / beatB);
    if (perBeat * 4 > 5) {
      const first = Math.ceil((v0 - secondsToBeats(a.beat)) / beatB);
      const downK = Math.round((a.downbeat - a.beat) / (60 / a.bpm));
      for (let k = first; ; k++) {
        const b = secondsToBeats(a.beat) + k * beatB;
        if (b > v1) break;
        const n = (((k - downK) % 32) + 32) % 32;
        const bar = n % 4 === 0;
        if (!bar && perBeat < 10) continue;
        g.fillStyle = n === 0 ? "rgba(255,255,255,0.32)" : bar ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)";
        g.fillRect(Math.round(x(b)), top, 1, h - 14 - top);
      }
    }
  }
  // the waveform
  if (a && a.peaks.length) {
    const cols = a.peaks.length;
    const perPx = (toSeconds(v1 - v0) * 25) / w;
    for (let px = 0; px < w; px++) {
      const s0 = toSeconds(v0) * 25 + px * perPx;
      const c0 = Math.floor(s0);
      const c1 = Math.max(c0 + 1, Math.floor(s0 + perPx));
      let peak = 0;
      let low = 0;
      let n = 0;
      for (let c = Math.max(0, c0); c < Math.min(cols, c1); c++) {
        if (a.peaks[c]! > peak) peak = a.peaks[c]!;
        low += a.lows[c]!;
        n++;
      }
      if (!n) continue;
      const hh = (peak / 255) * (mid - 2);
      const bass = hh * Math.min(1, low / n / 255 + 0.15);
      const played = o.pos !== null && v0 + ((px + 0.5) / w) * (v1 - v0) < o.pos;
      g.globalAlpha = played ? 0.45 : 0.9;
      g.fillStyle = "rgba(243, 237, 224, 0.55)";
      g.fillRect(px, mid - hh, 1, hh * 2);
      g.fillStyle = o.color;
      g.fillRect(px, mid - bass, 1, bass * 2);
    }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = "rgba(165, 159, 178, 0.35)";
    g.fillRect(0, mid, w, 1);
    g.fillStyle = "#a59fb2";
    g.font = "600 12px system-ui, sans-serif";
    g.fillText(`Analyzing…${o.progress && o.progress > 0.02 ? ` ${Math.round(o.progress * 100)}%` : ""} (it plays meanwhile)`, 10, mid - 6);
  }
  // times along the bottom
  const secs = toSeconds(v1 - v0);
  const step = TICKS.find((t) => (t / secs) * w >= 64) ?? 1200;
  g.font = "10px ui-monospace, monospace";
  g.fillStyle = "rgba(165, 159, 178, 0.9)";
  for (let t = Math.ceil(toSeconds(v0) / step) * step; t <= toSeconds(v1); t += step) {
    const px = x(secondsToBeats(t));
    g.fillRect(Math.round(px), h - 14, 1, 4);
    g.fillText(clockLabel(t), px + 2, h - 3);
  }
  // cues, and the saved point when you're trying another
  const marker = (b: number, color: string, label?: string) => {
    const px = Math.round(x(b));
    if (px < -40 || px > w + 40) return;
    g.fillStyle = color;
    g.fillRect(px, 0, 1, h - 14);
    g.beginPath();
    g.moveTo(px - 4, 0);
    g.lineTo(px + 4, 0);
    g.lineTo(px, 6);
    g.fill();
    if (label) {
      g.font = "700 10px system-ui, sans-serif";
      g.fillText(label, px + 3, 16);
    }
  };
  for (const c of o.cues) marker(c, "#ffd166");
  if (o.saved !== null && (o.point === null || Math.abs(o.saved - o.point) > 0.01)) marker(o.saved, "rgba(24, 224, 232, 0.8)", "SAVED");
  if (o.point !== null) {
    const px = Math.round(x(o.point));
    g.fillStyle = o.role === "out" ? "#ffb02e" : "#8dff3a";
    g.fillRect(px - 1, 0, 3, h - 14);
    g.font = "700 10px system-ui, sans-serif";
    const label = `${o.role === "out" ? "FADES" : "STARTS"} ${preciseClock(o.point)}`;
    g.fillText(label, Math.max(2, Math.min(w - g.measureText(label).width - 2, px + 4)), h - 18);
  }
  // your private preview (dotted), and where the live deck is (solid white)
  if (o.preview !== null) {
    g.fillStyle = "#18e0e8";
    const px = Math.round(x(o.preview));
    for (let y = 0; y < h - 14; y += 6) g.fillRect(px, y, 2, 3);
  }
  if (o.pos !== null) {
    g.fillStyle = "#ffffff";
    g.fillRect(Math.round(x(o.pos)) - 1, 0, 2, h - 14);
  }
}
