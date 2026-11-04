import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import "./glass.css";

/**
 * A HUD panel you can move and fold away: drag it by the bar along its top (or focus the bar and use the arrow
 * keys), fold it to a small chip with the button in its corner, and it stays where you left it next time. Each
 * panel keeps its usual spot on screen; moving it only shifts it from there, and never off the screen.
 */

interface Place {
  x: number;
  y: number;
  min: boolean;
}

const KEY = (id: string) => `cg.float.${id}`;
const EDGE = 8;
const STEP = 16;

function load(id: string): Place {
  try {
    const p = JSON.parse(localStorage.getItem(KEY(id)) ?? "null") as Partial<Place> | null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x!, y: p.y!, min: Boolean(p.min) };
  } catch {
    // nothing saved, or no storage here: its usual spot
  }
  return { x: 0, y: 0, min: false };
}

function save(id: string, p: Place) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(p));
  } catch {
    // only a convenience
  }
}

/** Put every floating panel back where it started, unfolded. */
export function resetPanels() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("cg.float.")) localStorage.removeItem(k);
  } catch {
    // nothing to forget
  }
  window.dispatchEvent(new Event("cg:panels-reset"));
}

type Props = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  /** Where it's remembered. */
  id: string;
  /** What it's called on its bar and its chip. */
  title: string;
  /** A picture for the chip when it's folded. */
  icon?: ReactNode;
  /** What the folded chip shows instead of the icon and title. */
  chip?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Floating({ id, title, icon, chip, className = "", children, style, ...rest }: Props) {
  const [place, setPlace] = useState<Place>(() => load(id));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; base: DOMRect } | null>(null);

  /** Keep the panel on the screen: an offset from where it would be without one. */
  const clamp = useCallback((x: number, y: number, base?: DOMRect) => {
    const el = box.current;
    if (!el) return { x, y };
    const r = base ?? (() => {
      const now = el.getBoundingClientRect();
      return new DOMRect(now.x - place.x, now.y - place.y, now.width, now.height);
    })();
    const w = window.innerWidth;
    const h = window.innerHeight;
    // at least the bar stays reachable, however tall the panel is; wider than the screen, its start stays on it
    const keep = Math.min(r.height, 48);
    return {
      x: Math.round(Math.max(Math.min(x, w - EDGE - r.right), EDGE - r.left)),
      y: Math.round(Math.max(Math.min(y, h - EDGE - r.top - keep), EDGE - r.top)),
    };
  }, [place.x, place.y]);

  const update = useCallback(
    (next: (p: Place) => Place) => {
      setPlace((p) => {
        const n = next(p);
        save(id, n);
        return n;
      });
    },
    [id],
  );

  // the window got smaller, or the panel grew: pull it back on
  useLayoutEffect(() => {
    const fit = () => {
      const c = clamp(place.x, place.y);
      if (c.x !== place.x || c.y !== place.y) update((p) => ({ ...p, ...c }));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [clamp, place, update]);

  useEffect(() => {
    const reset = () => setPlace(load(id));
    window.addEventListener("cg:panels-reset", reset);
    return () => window.removeEventListener("cg:panels-reset", reset);
  }, [id]);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !box.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = box.current.getBoundingClientRect();
    drag.current = { px: e.clientX, py: e.clientY, x: place.x, y: place.y, base: new DOMRect(now.x - place.x, now.y - place.y, now.width, now.height) };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    setPlace((p) => ({ ...p, ...clamp(d.x + e.clientX - d.px, d.y + e.clientY - d.py, d.base) }));
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    update((p) => p);
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const by = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
    if (by) {
      e.preventDefault();
      e.stopPropagation();
      update((p) => ({ ...p, ...clamp(p.x + by[0]!, p.y + by[1]!) }));
    } else if (e.key === "Home") {
      e.preventDefault();
      update((p) => ({ ...p, x: 0, y: 0 }));
    }
  };

  const fold = (min: boolean) => update((p) => ({ ...p, min }));

  return (
    <div
      ref={box}
      {...rest}
      className={`card floating ${className} ${place.min ? "minimized" : ""}`}
      style={{ ...style, translate: place.x || place.y ? `${place.x}px ${place.y}px` : undefined }}
    >
      <div className="float-bar">
        <button
          className="float-min"
          onClick={() => fold(!place.min)}
          aria-expanded={!place.min}
          aria-label={place.min ? `Open ${title}` : `Minimize ${title}`}
          title={place.min ? "Open" : "Minimize"}
        >
          <span aria-hidden>{place.min ? "+" : "–"}</span>
        </button>
        <button
          className="float-grip"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          onDoubleClick={() => update((p) => ({ ...p, x: 0, y: 0 }))}
          aria-label={`Move ${title}: drag, or use the arrow keys. Home puts it back.`}
          title="Drag to move · double-click to put back"
        >
          <span aria-hidden />
        </button>
      </div>
      {place.min ? (
        <button className="float-chip" onClick={() => fold(false)} aria-label={`Open ${title}`}>
          {chip ?? (
            <>
              {icon}
              <span>{title}</span>
            </>
          )}
        </button>
      ) : (
        children
      )}
    </div>
  );
}
