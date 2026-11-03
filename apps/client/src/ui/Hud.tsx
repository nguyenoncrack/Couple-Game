import { CharacterButton } from "../features/character/CharacterButton";
import { catalog, cookingDone, starterHouseOp, type FurnitureItem, type OpeningItem } from "@cg/shared";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WallMode } from "../render/House";
import { act, redo, serverNow, setFirstPerson, setMode, setTool, submit, undo, useGame, wake, type Tool } from "../state/game";
import { cameraApi } from "../render/CameraRig";
import { useThumbnail } from "../render/thumbnails";
import { deleteSelected, rotateSelected } from "../tools/BuildTools";
import { setMusic, useMusicOn } from "../state/music";
import { together } from "../state/together";
import { ChatButton, ChatPanel } from "./Chat";
import { Icon } from "./icons";
import { CatalogSearch } from "./CatalogSearch";
import { searchCatalog } from "./filterCatalog";
import { captureFirstPersonMouse, useFirstPersonMouse } from "../input/firstPersonMouse";

/** The on-screen controls, in the museum's paper-and-ink style. Everything here just reads and sets game state. */
export function Hud({ onLeave }: { onLeave: () => void }) {
  const status = useGame((s) => s.status);
  const live = useGame((s) => s.mode === "live");
  const firstPerson = useGame((s) => s.mode === "live" && s.firstPerson);
  return (
    <div className="hud">
      <TopBar onLeave={onLeave} />
      {status === "reconnecting" && <div className="banner">Reconnecting… your changes are kept and will sync.</div>}
      {!live && <ToolPanel />}
      {!live && <SelectionCard />}
      {!live && <StarterOffer />}
      <CookingCard />
      {firstPerson ? <FirstPersonHint /> : <CameraButtons />}
      {live ? <LiveBar /> : <Toolbar />}
      <ChatPanel />
      <Toasts />
      {status === "asleep" && <Asleep onLeave={onLeave} />}
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
  const music = useMusicOn();
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
          {status === "online" ? "saved" : status === "connecting" ? "connecting" : status === "reconnecting" ? "offline" : status === "asleep" ? "paused" : "closed"}
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
        <CharacterButton compact disabled={status !== "online"} onSaved={(appearance) => useGame.setState((s) => ({ members: s.members.map((m) => m.id === s.me ? { ...m, appearance } : m) }))} />
        <ChatButton />
        <button className="pill icon-pill" onClick={() => setMusic(!music)} title={music ? "Turn the music off" : "Turn the music on"} aria-pressed={music}>
          {music ? <Icon.music /> : <Icon.musicOff />}
        </button>
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
          <b>Two fingers</b> on a trackpad or screen to pan, <b>pinch</b> to zoom, <b>twist</b> to turn
        </li>
        <li>
          <b>Right-drag</b> or <b>Option + drag</b> to look around; mouse <b>wheel</b> zooms
        </li>
        <li>
          Keys: <b>W A S D</b> pan, <b>Q / E</b> turn, <b>H</b> for the whole lot
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
        <li>
          <b>L</b> switches between building and living in the house
        </li>
        <li>
          Living: <b>click</b> the floor to walk, <b>click</b> a sofa, bed, stove or plate for what you can do
        </li>
        <li>
          Living: <b>F</b> keeps the camera on you, <b>X</b> stands still
        </li>
        <li>
          Living: <b>V</b> sees through your own eyes and captures the mouse. <b>W A S D</b> walk, move the
          mouse to look, <b>E</b> uses what's ahead. <b>Esc</b> frees the cursor; <b>V</b> returns to the usual view.
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

/** Build or Live, at the start of the bar in both. */
function ModeSwitch() {
  const mode = useGame((s) => s.mode);
  return (
    <div className="mode-switch" title="Build or live in the house (L)">
      <button className={mode === "build" ? "on" : ""} onClick={() => setMode("build")}>
        <Icon.hammer /> Build
      </button>
      <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>
        <Icon.person /> Live
      </button>
    </div>
  );
}

function WallModeButton() {
  const mode = useGame((s) => s.wallMode);
  const wallMode = WALL_MODES.find((m) => m.mode === mode) ?? WALL_MODES[0]!;
  return (
    <button className={`slot round ${wallMode.mode !== "up" ? "active" : ""}`} onClick={cycleWallMode} title="Walls: up, cutaway, down (T)">
      <wallMode.icon />
      <span className="slot-label">{wallMode.label}</span>
    </button>
  );
}

/** In first person: a dot in the middle of the view, and how to get about. */
function FirstPersonHint() {
  const locked = useFirstPersonMouse((s) => s.locked);
  const error = useFirstPersonMouse((s) => s.error);
  const menu = useGame((s) => Boolean(s.menu) || s.chatOpen);
  return (
    <>
      {locked && <div className="crosshair" aria-hidden />}
      {!locked && !menu && <div className="card fp-resume">
        <button className="btn primary" onClick={() => captureFirstPersonMouse()}>Click to look around</button>
        <p className="hand">{error ?? "Mouse released · WASD movement is paused."}</p>
        <p className="hand">Press V to return to the usual view.</p>
      </div>}
      <div className="fp-hint hand">
        <b>W A S D</b> walk · <b>Mouse</b> look · <b>E</b> use · <b>Esc</b> free cursor · <b>V</b> step out
      </div>
    </>
  );
}

function LiveBar() {
  const follow = useGame((s) => s.follow);
  const firstPerson = useGame((s) => s.firstPerson);
  const busy = useGame((s) => Boolean(s.me && s.life?.avatars[s.me]?.use));
  const { here, inBed, cuddling } = useGame(useShallow(together));
  return (
    <div className="toolbar">
      <ModeSwitch />
      <span className="toolbar-gap" />
      {here && inBed && (
        <button className={`slot round ${cuddling ? "active" : ""}`} onClick={() => act({ do: "social", action: cuddling ? "uncuddle" : "cuddle" })} title={cuddling ? "Stop cuddling" : "Cuddle up"}>
          <Icon.hug />
          <span className="slot-label">{cuddling ? "Let go" : "Cuddle"}</span>
        </button>
      )}
      {here && !inBed && (
        <>
          <button className="slot round" onClick={() => act({ do: "social", action: "hug" })} title="Go and hug your partner">
            <Icon.hug />
            <span className="slot-label">Hug</span>
          </button>
          <button className="slot round" onClick={() => act({ do: "social", action: "kiss" })} title="Go and kiss your partner">
            <Icon.kiss />
            <span className="slot-label">Kiss</span>
          </button>
        </>
      )}
      {here && <span className="toolbar-gap" />}
      <button className={`slot round ${firstPerson ? "active" : ""}`} onClick={() => setFirstPerson(!firstPerson)} title="See through your own eyes (V)">
        <Icon.eye />
        <span className="slot-label">{firstPerson ? "Step out" : "Eyes"}</span>
      </button>
      {!firstPerson && <WallModeButton />}
      {!firstPerson && (
        <button className={`slot round ${follow ? "active" : ""}`} onClick={() => useGame.setState({ follow: !follow })} title="Keep the camera on you (F)">
          <Icon.follow />
          <span className="slot-label">Follow</span>
        </button>
      )}
      <button className="slot round" onClick={() => act({ do: "stop" })} disabled={!busy} title="Stand up, stop what you're doing (X)">
        <Icon.stand />
        <span className="slot-label">Stand</span>
      </button>
    </div>
  );
}

function Toolbar() {
  const tool = useGame((s) => s.tool);
  const canUndo = useGame((s) => s.canUndo);
  const canRedo = useGame((s) => s.canRedo);
  return (
    <div className="toolbar">
      <ModeSwitch />
      <span className="toolbar-gap" />
      {TOOLS.map((t) => (
        <button key={t.tool} className={`slot ${tool === t.tool ? "active" : ""}`} onClick={() => setTool(t.tool)} title={`${t.label} (${t.key})`}>
          <span className="slot-key">{t.key}</span>
          <t.icon />
          <span className="slot-label">{t.label}</span>
        </button>
      ))}
      <span className="toolbar-gap" />
      <WallModeButton />
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
  { id: "entertainment", label: "Entertainment" },
  { id: "openings", label: "Doors & windows" },
];

/** A colour to stand for an item in the catalog (its main fabric, wood or body colour). */
function itemColor(item: FurnitureItem | OpeningItem) {
  const m = item.model as Record<string, unknown>;
  for (const k of ["fabric", "blanket", "color", "cabinet", "body", "wood", "shade", "leaves", "cushion", "canopy", "water", "leaf", "panel", "top", "felt"]) if (typeof m[k] === "string") return m[k] as string;
  return "#cfe2ea";
}

/** What a catalog entry shows as its size: a footprint, or how many wall tiles wide. */
const itemSize = (i: FurnitureItem | OpeningItem) => ("footprint" in i ? `${i.footprint[0]}×${i.footprint[1]}` : `${i.width} wide`);

/** The item drawn small, with its size; its main colour stands in until the picture is ready. */
function ItemPicture({ item, size = true }: { item: FurnitureItem | OpeningItem; size?: boolean }) {
  const picture = useThumbnail(item.id);
  return (
    <span className={`item-chip ${picture ? "drawn" : ""}`} style={picture ? undefined : { background: itemColor(item) }}>
      {picture && <img src={picture} alt="" draggable={false} />}
      {size && <span className="item-size">{itemSize(item)}</span>}
    </span>
  );
}

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
              <ItemPicture item={i} />
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
                : category === "entertainment"
                  ? "Play PS5 near a TV in Live mode. Tables are decorative for now."
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
      <div className="sel-head">
        {item && <ItemPicture item={item} size={false} />}
        <div>
          <div className="kicker">Selected</div>
          <div className="sel-name">{item?.name ?? o.catalogId}</div>
        </div>
      </div>
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

/** The meal on the go: each step, how far along, who's where, and a hand to lend. */
function CookingCard() {
  const cooking = useGame((s) => s.life?.cooking ?? null);
  const avatars = useGame((s) => s.life?.avatars);
  const members = useGame((s) => s.members);
  const me = useGame((s) => s.me);
  const [, tick] = useState(0);
  // progress moves between server updates: redraw a few times a second while cooking
  useEffect(() => {
    if (!cooking) return;
    const t = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, [cooking]);
  if (!cooking || !avatars) return null;
  const recipe = catalog.recipes.get(cooking.recipeId);
  if (!recipe) return null;
  const done = cookingDone(cooking, recipe, serverNow());
  const cooks = Object.values(avatars).filter((a) => a.use?.station);
  const amCooking = Boolean(me && avatars[me]?.use?.station);
  const name = (id: string) => (id === me ? "You" : (members.find((m) => m.id === id)?.name ?? "Someone"));
  return (
    <div className="card cooking-card">
      <div className="kicker">
        <Icon.pot /> Cooking
      </div>
      <div className="sel-name">{recipe.name}</div>
      <ol className="steps">
        {recipe.steps.map((st, i) => {
          const pct = i < cooking.step ? 100 : i > cooking.step ? 0 : (done / st.seconds) * 100;
          const at = cooks.filter((a) => a.use!.station === st.station).map((a) => name(a.memberId));
          return (
            <li key={i} className={i < cooking.step ? "done" : i === cooking.step ? "now" : ""}>
              <span className="step-name">
                {st.action[0]!.toUpperCase() + st.action.slice(1)} <span className="step-where">at the {st.station}</span>
              </span>
              <span className="bar">
                <span style={{ width: `${pct}%` }} />
              </span>
              {i === cooking.step && (
                <span className="step-who">{cooking.rate > 1
                    ? `${cooks.map((a) => name(a.memberId)).join(" & ")}, together: faster`
                    : cooking.rate > 0
                      ? `${at.join(" & ") || "Someone"} on it`
                      : `Waiting for someone at the ${st.station}`}</span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="sel-actions">
        {!amCooking && (
          <button className="btn primary" onClick={() => act({ do: "help" })}>
            Lend a hand
          </button>
        )}
        <button className="btn danger" onClick={() => act({ do: "cancel" })}>
          Stop cooking
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

/** The house let go of us after a long quiet spell (or a long-hidden tab); nothing is lost. */
function Asleep({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="overlay">
      <div className="card gone-card">
        <h2>The house is napping</h2>
        <p className="hand">Nobody did anything for a while, so it paused to save energy. Everything is saved.</p>
        <div className="row">
          <button className="btn primary" onClick={wake}>
            Come back in
          </button>
          <button className="btn" onClick={onLeave}>
            Back home
          </button>
        </div>
      </div>
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
