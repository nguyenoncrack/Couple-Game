import { catalog, type FurnitureItem } from "@cg/shared";
import { useState } from "react";
import { setTool, useGame, type Tool } from "../state/game";
import { deleteSelected, rotateSelected } from "../tools/BuildTools";
import { Icon } from "./icons";

/** The on-screen controls, in the museum's paper-and-ink style. Everything here just reads and sets game state. */
export function Hud({ onLeave }: { onLeave: () => void }) {
  const status = useGame((s) => s.status);
  return (
    <div className="hud">
      <TopBar onLeave={onLeave} />
      {status === "reconnecting" && <div className="banner">Reconnecting… your changes are kept and will sync.</div>}
      <ToolPanel />
      <SelectionCard />
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
          <b>Right-drag</b> to look around, <b>scroll</b> to zoom
        </li>
        <li>
          <b>W A S D</b> to pan, <b>Q / E</b> to turn the view
        </li>
        <li>
          <b>Drag</b> along grid lines to build or erase walls
        </li>
        <li>
          <b>Drag</b> over tiles to lay or lift floors
        </li>
        <li>
          <b>Click</b> furniture to pick it, <b>drag</b> to move it
        </li>
        <li>
          <b>R</b> rotates, <b>Delete</b> removes, <b>Esc</b> lets go
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
  { tool: "buy", label: "Furniture", icon: Icon.buy, key: "6" },
];

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key, t.tool]));

function Toolbar() {
  const tool = useGame((s) => s.tool);
  const wallsDown = useGame((s) => s.wallsDown);
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
      <button className={`slot round ${wallsDown ? "active" : ""}`} onClick={() => useGame.setState({ wallsDown: !wallsDown })} title="Walls up / down (T)">
        {wallsDown ? <Icon.wallsDown /> : <Icon.wallsUp />}
        <span className="slot-label">{wallsDown ? "Walls down" : "Walls up"}</span>
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

const CATEGORIES: { id: FurnitureItem["category"]; label: string }[] = [
  { id: "living", label: "Living" },
  { id: "bedroom", label: "Bedroom" },
  { id: "kitchen", label: "Kitchen" },
  { id: "bathroom", label: "Bathroom" },
  { id: "decor", label: "Decor" },
];

/** A colour to stand for an item in the catalog (its main fabric, wood or body colour). */
function itemColor(item: FurnitureItem) {
  const m = item.model as Record<string, unknown>;
  for (const k of ["fabric", "blanket", "color", "cabinet", "body", "wood", "shade", "leaves"]) if (typeof m[k] === "string") return m[k] as string;
  return "#efe9dc";
}

function ToolPanel() {
  const tool = useGame((s) => s.tool);
  const wallStyle = useGame((s) => s.wallStyle);
  const floorMaterial = useGame((s) => s.floorMaterial);
  const placing = useGame((s) => s.placing);
  const [category, setCategory] = useState<FurnitureItem["category"]>("living");

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
    const items = [...catalog.furniture.values()].filter((i) => i.category === category);
    return (
      <div className="card tool-panel catalog">
        <div className="tabs">
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`tab ${category === c.id ? "active" : ""}`} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="items">
          {items.map((i) => (
            <button
              key={i.id}
              className={`item ${placing?.catalogId === i.id ? "active" : ""}`}
              onClick={() => useGame.setState({ placing: placing?.catalogId === i.id ? null : { catalogId: i.id, rot: 0 } })}
            >
              <span className="item-chip" style={{ background: itemColor(i) }}>
                <span className="item-size">
                  {i.footprint[0]}×{i.footprint[1]}
                </span>
              </span>
              <span className="item-name">{i.name}</span>
              <span className="item-price">${i.price}</span>
            </button>
          ))}
        </div>
        <p className="hint hand">{placing ? "Click to place · R to turn · Esc to stop" : "Pick something, then click on the lot."}</p>
      </div>
    );
  }
  return null;
}

function SelectionCard() {
  const selection = useGame((s) => s.selection);
  const o = useGame((s) => (s.selection ? s.view?.levels[0]?.objects[s.selection] : undefined));
  if (!selection || !o) return null;
  const item = catalog.furniture.get(o.catalogId);
  return (
    <div className="card selection-card">
      <div className="kicker">Selected</div>
      <div className="sel-name">{item?.name ?? o.catalogId}</div>
      <div className="sel-actions">
        <button className="btn" onClick={rotateSelected}>
          <Icon.rotate /> Rotate <kbd>R</kbd>
        </button>
        <button className="btn danger" onClick={deleteSelected}>
          <Icon.trash /> Remove <kbd>Del</kbd>
        </button>
      </div>
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
