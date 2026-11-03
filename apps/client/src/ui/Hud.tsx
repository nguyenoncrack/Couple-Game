import { catalog, starterHouseOp, type FurnitureItem, type OpeningItem } from "@cg/shared";
import { useState } from "react";
import type { WallMode } from "../render/House";
import { redo, setTool, submit, undo, useGame, type Tool } from "../state/game";
import { cameraApi } from "../render/CameraRig";
import { deleteSelected, rotateSelected } from "../tools/BuildTools";
import { Icon } from "./icons";
import { CatalogSearch } from "./CatalogSearch";
import { searchCatalog } from "./filterCatalog";

/** The on-screen controls, in the museum's paper-and-ink style. Everything here just reads and sets game state. */
export function Hud({ onLeave }: { onLeave: () => void }) {
  const status = useGame((s) => s.status);
  return (
    <div className="hud">
      <TopBar onLeave={onLeave} />
      {status === "reconnecting" && <div className="banner">Reconnecting… your changes are kept and will sync.</div>}
      <ToolPanel />
      <SelectionCard />
      <StarterOffer />
      <CameraButtons />
      <Toolbar />
      <Toasts />
      {status === "gone" && <Gone onLeave={onLeave} />}
    </div>
  );
}

function TopBar({ onLeave }: { onLeave: () => void }) {
  const house = useGame((s) => s.house);
  const members = useGame((s) => s.members);
  const me = useGame((s) => s.me);
  const status = useGame((s) => s.status);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const partner = members.find((m) => m.id !== me);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="pill icon-pill" onClick={onLeave} title="Back to your houses">
          <Icon.back />
        </button>
        <div className="pill title-pill">{house?.houseName ?? "…"}</div>
        <div className={`pill status-pill status-${status}`}>
          <span className="status-dot" />
          {status === "online" ? "saved" : status === "connecting" ? "connecting" : status === "reconnecting" ? "offline" : "closed"}
        </div>
      </div>
      <div className="topbar-right">
        {members.map((m) => (
          <div key={m.id} className={`pill member-pill ${m.online ? "" : "away"}`} title={m.online ? "Here now" : "Away"}>
            <span className="avatar" style={{ background: m.color }}>
              {m.name.slice(0, 1).toUpperCase()}
            </span>
            {m.name}
            {m.id === me && <span className="you">you</span>}
          </div>
        ))}
        {!partner && (
          <button className="pill invite-pill" onClick={() => setInviteOpen((v) => !v)}>
            <Icon.link /> Invite your partner
          </button>
        )}
        {partner && (
          <button className="pill icon-pill" onClick={() => setInviteOpen((v) => !v)} title="Room code">
            <Icon.link />
          </button>
        )}
        <button className="pill icon-pill" onClick={() => setHelpOpen((v) => !v)} title="Controls">
          <Icon.help />
        </button>
      </div>
      {inviteOpen && house && <InviteCard code={house.inviteCode} full={Boolean(partner)} onClose={() => setInviteOpen(false)} />}
      {helpOpen && <HelpCard onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function InviteCard({ code, full, onClose }: { code: string; full: boolean; onClose: () => void }) {
  const link = `${location.origin}/join/${code}`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div className="card popover invite-card">
      <div className="kicker">Room code</div>
      <div className="code">{code}</div>
      {full ? (
        <p className="hand">You're both in. This house is full.</p>
      ) : (
        <>
          <p className="hand">Send this link to your partner, or have them type the code on the home screen.</p>
          <div className="link-row">
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={() => copy(link, "link")}>
              {copied === "link" ? "Copied!" : "Copy link"}
            </button>
          </div>
        </>
      )}
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

function HelpCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="card popover help-card">
      <div className="kicker">Controls</div>
      <ul className="hand">
        <li>
          <b>Right-drag</b> or <b>Option + drag</b> to look around
        </li>
        <li>
          <b>Space + drag</b>, <b>Shift + right-drag</b> or <b>W A S D</b> to pan
        </li>
        <li>
          <b>Scroll</b> or <b>pinch</b> to zoom, <b>Q / E</b> to turn, <b>H</b> for the whole lot
        </li>
        <li>Dragging near the screen edge while building moves the view along</li>
        <li>
          <b>Drag</b> along grid lines to build or erase walls
        </li>
        <li>
          <b>Drag</b> over tiles to lay or lift floors
        </li>
        <li>
          <b>Click</b> furniture, a door or a window to pick it, <b>drag</b> to move it
        </li>
        <li>
          Doors and windows snap into the nearest wall
        </li>
        <li>
          <b>R</b> rotates (or flips a door), <b>Delete</b> removes, <b>Esc</b> lets go
        </li>
        <li>
          <b>⌘Z</b> / <b>Ctrl+Z</b> undoes, <b>⇧⌘Z</b> / <b>Ctrl+Y</b> redoes your own edits
        </li>
        <li>
          <b>T</b> switches walls between up, cutaway and down
        </li>
      </ul>
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

const TOOLS: { tool: Tool; label: string; icon: () => React.JSX.Element; key: string }[] = [
  { tool: "select", label: "Select", icon: Icon.select, key: "1" },
  { tool: "wall", label: "Walls", icon: Icon.wall, key: "2" },
  { tool: "wallErase", label: "Erase walls", icon: Icon.wallErase, key: "3" },
  { tool: "floor", label: "Floor", icon: Icon.floor, key: "4" },
  { tool: "floorErase", label: "Lift floor", icon: Icon.floorErase, key: "5" },
  { tool: "buy", label: "Buy", icon: Icon.buy, key: "6" },
];

export const WALL_MODES: { mode: WallMode; label: string; icon: () => React.JSX.Element }[] = [
  { mode: "up", label: "Walls up", icon: Icon.wallsUp },
  { mode: "cut", label: "Cutaway", icon: Icon.wallsCut },
  { mode: "down", label: "Walls down", icon: Icon.wallsDown },
];

export function cycleWallMode() {
  const i = WALL_MODES.findIndex((m) => m.mode === useGame.getState().wallMode);
  useGame.setState({ wallMode: WALL_MODES[(i + 1) % WALL_MODES.length]!.mode });
}

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key, t.tool]));

function Toolbar() {
  const tool = useGame((s) => s.tool);
  const mode = useGame((s) => s.wallMode);
  const wallMode = WALL_MODES.find((m) => m.mode === mode) ?? WALL_MODES[0]!;
  const canUndo = useGame((s) => s.canUndo);
  const canRedo = useGame((s) => s.canRedo);
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.tool} className={`slot ${tool === t.tool ? "active" : ""}`} onClick={() => setTool(t.tool)} title={`${t.label} (${t.key})`}>
          <span className="slot-key">{t.key}</span>
          <t.icon />
          <span className="slot-label">{t.label}</span>
        </button>
      ))}
      <span className="toolbar-gap" />
      <button className={`slot round ${wallMode.mode !== "up" ? "active" : ""}`} onClick={cycleWallMode} title="Walls: up, cutaway, down (T)">
        <wallMode.icon />
        <span className="slot-label">{wallMode.label}</span>
      </button>
      <span className="toolbar-gap" />
      <button className="slot round small" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
        <Icon.undo />
        <span className="slot-label">Undo</span>
      </button>
      <button className="slot round small" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        <Icon.redo />
        <span className="slot-label">Redo</span>
      </button>
    </div>
  );
}

function CameraButtons() {
  return (
    <div className="camera-buttons">
      <button className="pill icon-pill" onClick={() => cameraApi.turn(-1)} title="Turn left (Q)">
        <Icon.turnLeft />
      </button>
      <button className="pill icon-pill" onClick={() => cameraApi.turn(1)} title="Turn right (E)">
        <Icon.turnRight />
      </button>
      <button className="pill icon-pill" onClick={() => cameraApi.zoom(1)} title="Zoom in (+)">
        <Icon.plus />
      </button>
      <button className="pill icon-pill" onClick={() => cameraApi.zoom(-1)} title="Zoom out (−)">
        <Icon.minus />
      </button>
      <button className="pill icon-pill" onClick={cameraApi.recenter} title="Whole lot (H)">
        <Icon.home />
      </button>
    </div>
  );
}

function Swatch({ color, label, active, onClick }: { color: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`swatch ${active ? "active" : ""}`} onClick={onClick} title={label}>
      <span className="swatch-chip" style={{ background: color }} />
      <span className="swatch-label">{label}</span>
    </button>
  );
}

type Category = FurnitureItem["category"] | "openings";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "living", label: "Living" },
  { id: "bedroom", label: "Bedroom" },
  { id: "kitchen", label: "Kitchen" },
  { id: "bathroom", label: "Bathroom" },
  { id: "decor", label: "Decor" },
  { id: "outdoor", label: "Outdoor" },
  { id: "openings", label: "Doors & windows" },
];

/** A colour to stand for an item in the catalog (its main fabric, wood or body colour). */
function itemColor(item: FurnitureItem | OpeningItem) {
  const m = item.model as Record<string, unknown>;
  for (const k of ["fabric", "blanket", "color", "cabinet", "body", "wood", "shade", "leaves", "cushion", "canopy", "water", "leaf", "panel"]) if (typeof m[k] === "string") return m[k] as string;
  return "#cfe2ea";
}

/** What a catalog entry shows as its size: a footprint, or how many wall tiles wide. */
const itemSize = (i: FurnitureItem | OpeningItem) => ("footprint" in i ? `${i.footprint[0]}×${i.footprint[1]}` : `${i.width} wide`);

function ToolPanel() {
  const tool = useGame((s) => s.tool);
  const wallStyle = useGame((s) => s.wallStyle);
  const floorMaterial = useGame((s) => s.floorMaterial);
  const placing = useGame((s) => s.placing);
  const [category, setCategory] = useState<Category>("living");
  const [query, setQuery] = useState("");

  if (tool === "wall")
    return (
      <div className="card tool-panel">
        <div className="kicker">Wall style</div>
        <div className="swatches">
          {[...catalog.wallStyles.values()].map((s) => (
            <Swatch key={s.id} color={s.color} label={s.name} active={wallStyle === s.id} onClick={() => useGame.setState({ wallStyle: s.id })} />
          ))}
        </div>
        <p className="hint hand">Drag along the grid lines. Draw over a wall to repaint it.</p>
      </div>
    );
  if (tool === "floor")
    return (
      <div className="card tool-panel">
        <div className="kicker">Floor</div>
        <div className="swatches">
          {[...catalog.floorMaterials.values()].map((m) => (
            <Swatch key={m.id} color={m.color} label={m.name} active={floorMaterial === m.id} onClick={() => useGame.setState({ floorMaterial: m.id })} />
          ))}
        </div>
        <p className="hint hand">Drag a rectangle of tiles.</p>
      </div>
    );
  if (tool === "wallErase" || tool === "floorErase")
    return (
      <div className="card tool-panel slim">
        <p className="hint hand">{tool === "wallErase" ? "Drag along a wall to knock it down." : "Drag over tiles to lift the floor."}</p>
      </div>
    );
  if (tool === "buy") {
    const searching = Boolean(query.trim());
    const items: (FurnitureItem | OpeningItem)[] = searching
      ? searchCatalog([...catalog.furniture.values(), ...catalog.openings.values()], query)
      : category === "openings" ? [...catalog.openings.values()] : [...catalog.furniture.values()].filter((i) => i.category === category);
    const placingOpening = placing ? catalog.openings.has(placing.catalogId) : false;
    return (
      <div className="card tool-panel catalog">
        <div className="tabs">
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`tab ${!searching && category === c.id ? "active" : ""}`} aria-pressed={!searching && category === c.id} onClick={() => { setCategory(c.id); setQuery(""); }}>
              {c.label}
            </button>
          ))}
        </div>
        <CatalogSearch query={query} onChange={setQuery} count={items.length} />
        {searching && items.length === 0 && <p className="catalog-empty hand">Nothing found. Try “sofa”, “sink” or “window”, or clear your search.</p>}
        <div className="items" key={searching ? query : category}>
          {items.map((i) => (
            <button
              key={i.id}
              className={`item ${placing?.catalogId === i.id ? "active" : ""}`}
              onClick={() => useGame.setState({ placing: placing?.catalogId === i.id ? null : { catalogId: i.id, rot: 0 } })}
            >
              <span className="item-chip" style={{ background: itemColor(i) }}>
                <span className="item-size">{itemSize(i)}</span>
              </span>
              <span className="item-name">{i.name}</span>
              <span className="item-price">${i.price}</span>
            </button>
          ))}
        </div>
        <p className="hint hand">
          {placingOpening
            ? "Point at a wall and click · R to face it the other way · Esc to stop"
            : placing
              ? "Click to place · R to turn · Esc to stop"
              : category === "openings"
                ? "Pick a door or window, then click on a wall."
                : "Pick something, then click on the lot."}
        </p>
      </div>
    );
  }
  return null;
}

function SelectionCard() {
  const selection = useGame((s) => s.selection);
  const o = useGame((s) => (s.selection ? (s.view?.levels[0]?.objects[s.selection] ?? s.view?.levels[0]?.openings[s.selection]) : undefined));
  if (!selection || !o) return null;
  const opening = catalog.openings.get(o.catalogId);
  const item = opening ?? catalog.furniture.get(o.catalogId);
  return (
    <div className="card selection-card">
      <div className="kicker">Selected</div>
      <div className="sel-name">{item?.name ?? o.catalogId}</div>
      <div className="sel-actions">
        <button className="btn" onClick={rotateSelected}>
          {opening ? (
            <>
              <Icon.flip /> Flip <kbd>R</kbd>
            </>
          ) : (
            <>
              <Icon.rotate /> Rotate <kbd>R</kbd>
            </>
          )}
        </button>
        <button className="btn danger" onClick={deleteSelected}>
          <Icon.trash /> Remove <kbd>Del</kbd>
        </button>
      </div>
    </div>
  );
}

/** On an empty lot, offer the starter house. It arrives as one edit, so Undo takes it all away again. */
function StarterOffer() {
  const empty = useGame((s) => {
    const l = s.view?.levels[0];
    return Boolean(l) && !Object.keys(l!.walls).length && !Object.keys(l!.objects).length && !Object.keys(l!.tiles).length;
  });
  const online = useGame((s) => s.status === "online");
  if (!empty) return null;
  return (
    <div className="card starter-card">
      <div className="kicker">An empty lot</div>
      <p className="hand">Build from scratch, or start with a house you can change: two bedrooms, a bathroom, an open kitchen and living room, a garage and a pool.</p>
      <button className="btn primary" disabled={!online} onClick={() => submit(starterHouseOp())}>
        <Icon.house /> Build the starter house
      </button>
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast hand">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Gone({ onLeave }: { onLeave: () => void }) {
  const reason = useGame((s) => s.goneReason);
  return (
    <div className="overlay">
      <div className="card gone-card">
        <h2>Left the house</h2>
        <p className="hand">{reason}</p>
        <div className="row">
          <button className="btn" onClick={() => location.reload()}>
            Reopen here
          </button>
          <button className="btn primary" onClick={onLeave}>
            Back home
          </button>
        </div>
      </div>
    </div>
  );
}
