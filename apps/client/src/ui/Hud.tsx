import { catalog, cookingDone, costOf, enclosedCells, RESALE, resaleValue, starterHouseOp, type FurnitureItem, type OpeningItem } from "@cg/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WallMode } from "../render/House";
import { act, redo, roofVisible, serverNow, setFirstPerson, setMode, setRoofShown, setTool, submit, toast, undo, useGame, wake, type Tool } from "../state/game";
import { cameraApi } from "../render/CameraRig";
import { useThumbnail } from "../render/thumbnails";
import { deleteSelected, rotateSelected } from "../tools/BuildTools";
import { openPartnerMenu } from "../tools/LiveTools";
import { together } from "../state/together";
import { ChatPanel } from "./Chat";
import { Icon } from "./icons";
import { CatalogSearch } from "./CatalogSearch";
import { searchCatalog } from "./filterCatalog";
import { useFirstPersonMouse } from "../input/firstPersonMouse";
import { TableGamePanel } from "./TableGamePanel";
import { NeedsPanel } from "./Needs";
import { ClockPill, WelcomeBack } from "./Calendar";
import { Floating } from "./Floating";
import { Phone } from "./Phone";
import { MaterialPanel } from "../features/buildMaterials/MaterialPanel";
import { FloorPicker } from "./FloorPicker";
import { MusicDock } from "../features/party/MusicDock";
import { PartyHud } from "../features/party/PartyPanel";
import { colorsOf, familyOf, groupVariants, VariantSwatches } from "./VariantSwatches";

/** The on-screen controls, in the museum's paper-and-ink style. Everything here just reads and sets game state. */
export function Hud({ onLeave }: { onLeave: () => void }) {
  const status = useGame((s) => s.status);
  const dropReason = useGame((s) => s.dropReason);
  const live = useGame((s) => s.mode === "live");
  const firstPerson = useGame((s) => s.mode === "live" && s.firstPerson);
  return (
    <div className="hud">
      <TopBar onLeave={onLeave} />
      {status === "reconnecting" && (
        <div className="banner">
          Reconnecting… your changes are kept and will sync.
          {dropReason && <span className="banner-why">{dropReason}</span>}
        </div>
      )}
      {!live && <ToolPanel />}
      {!live && <SelectionCard />}
      {!live && <StarterOffer />}
      {live && !firstPerson && <NeedsPanel />}
      <CookingCard />
      {live && <TableGamePanel />}
      {firstPerson ? <FirstPersonHint /> : <CameraButtons />}
      {live ? <LiveBar /> : <Toolbar />}
      <ChatPanel />
      <PartyHud />
      <MusicDock />
      <WelcomeBack />
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
  const partner = members.find((m) => m.id !== me);
  const bar = useRef<HTMLDivElement>(null);
  // the bar wraps onto more rows on narrow screens: panels below it go by where it actually ends
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const place = () => document.documentElement.style.setProperty("--topbar-bottom", `${Math.round(el.getBoundingClientRect().bottom)}px`);
    place();
    const watch = new ResizeObserver(place);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div className="topbar" ref={bar}>
      <div className="topbar-left">
        <button className="pill icon-pill" onClick={onLeave} title="Back to your houses">
          <Icon.back />
        </button>
        <div className="pill title-pill">{house?.houseName ?? "…"}</div>
        <div className={`pill status-pill status-${status}`}>
          <span className="status-dot" />
          {status === "online" ? "saved" : status === "connecting" ? "connecting" : status === "reconnecting" ? "offline" : status === "asleep" ? "paused" : "closed"}
        </div>
        <ClockPill />
      </div>
      <div className="topbar-right">
        <Phone onInvite={() => setInviteOpen(true)} onHelp={() => setHelpOpen(true)} />
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
          <b>Roof</b> tool: drag over rooms to cover them, or roof the whole house in one go. <b>O</b> shows or hides the roof
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
  { tool: "roof", label: "Roof", icon: Icon.roof, key: "7" },
];

export const WALL_MODES: { mode: WallMode; label: string; icon: () => React.JSX.Element }[] = [
  { mode: "up", label: "Walls up", icon: Icon.wallsUp },
  { mode: "cut", label: "Cutaway", icon: Icon.wallsCut },
  { mode: "down", label: "Walls down", icon: Icon.wallsDown },
];

export function cycleWallMode() {
  // walls stand up under a roof, so the first press takes the roof away to show the walls as they're set
  if (roofVisible(useGame.getState())) return setRoofShown(false);
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
  const mode = useGame((s) => (roofVisible(s) ? "up" : s.wallMode));
  const wallMode = WALL_MODES.find((m) => m.mode === mode) ?? WALL_MODES[0]!;
  return (
    <button className={`slot round ${wallMode.mode !== "up" ? "active" : ""}`} onClick={cycleWallMode} title="Walls: up, cutaway, down (T)">
      <wallMode.icon />
      <span className="slot-label">{wallMode.label}</span>
    </button>
  );
}

export function toggleRoof() {
  const s = useGame.getState();
  if (!s.roofShown && !(s.view?.levels ?? []).some((l) => Object.keys(l.roofs).length)) toast("No roof yet. Build one with the Roof tool.");
  setRoofShown(!s.roofShown);
}

function RoofButton() {
  const shown = useGame((s) => s.roofShown);
  const has = useGame((s) => (s.view?.levels ?? []).some((l) => Object.keys(l.roofs).length > 0));
  const on = shown && has;
  return (
    <button className={`slot round ${on ? "active" : ""}`} onClick={toggleRoof} title={on ? "Hide the roof (O)" : "Show the roof (O)"}>
      {on ? <Icon.roofOn /> : <Icon.roofOff />}
      <span className="slot-label">{on ? "Roof on" : "Roof off"}</span>
    </button>
  );
}

/** In first person: a dot in the middle of the view, and how to get about. */
function FirstPersonHint() {
  const locked = useFirstPersonMouse((s) => s.locked);
  const error = useFirstPersonMouse((s) => s.error);
  return (
    <>
      {locked && <div className="crosshair" aria-hidden />}
      <div className="fp-hint hand">
        {error ?? <><b>W A S D</b> walk · <b>Mouse</b> look · <b>E</b> use · <b>Esc</b> free cursor · <b>V</b> step out</>}
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
    <Floating id="toolbar" title="Tools" icon={<Icon.house />} className="toolbar">
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
          <button className="slot round" onClick={openPartnerMenu} title="Dance, high five, chat and more with your partner">
            <Icon.more />
            <span className="slot-label">More</span>
          </button>
        </>
      )}
      {here && <span className="toolbar-gap" />}
      <button className={`slot round ${firstPerson ? "active" : ""}`} onClick={() => setFirstPerson(!firstPerson)} title="See through your own eyes (V)">
        <Icon.eye />
        <span className="slot-label">{firstPerson ? "Step out" : "Eyes"}</span>
      </button>
      {!firstPerson && <WallModeButton />}
      <RoofButton />
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
    </Floating>
  );
}

function Toolbar() {
  const tool = useGame((s) => s.tool);
  const canUndo = useGame((s) => s.canUndo);
  const canRedo = useGame((s) => s.canRedo);
  return (
    <Floating id="toolbar" title="Tools" icon={<Icon.house />} className="toolbar">
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
      <RoofButton />
      <span className="toolbar-gap" />
      <button className="slot round small" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
        <Icon.undo />
        <span className="slot-label">Undo</span>
      </button>
      <button className="slot round small" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        <Icon.redo />
        <span className="slot-label">Redo</span>
      </button>
    </Floating>
  );
}

function CameraButtons() {
  return (
    <div className="camera-buttons">
      <FloorPicker />
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
  { id: "party", label: "Party" },
  { id: "office", label: "Office" },
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

/** Put a roof over every room shut in by walls, in the chosen style. */
function roofHouse() {
  const s = useGame.getState();
  const level = s.view?.levels[s.floor];
  if (!level || !s.view) return;
  const cells = enclosedCells(level.walls, s.view.lot.w, s.view.lot.d).filter((c) => level.roofs[c]?.style !== s.roofStyle);
  if (!cells.length) {
    toast(Object.keys(level.roofs).length ? "The house already has that roof." : "Close in a room with walls first, or drag the roof where you want it.");
    return;
  }
  submit({ t: "roof.paint", level: s.floor, cells, style: s.roofStyle });
}

/** Take the roof off the floor you're on. */
function clearRoof() {
  const s = useGame.getState();
  const cells = Object.keys(s.view?.levels[s.floor]?.roofs ?? {});
  if (cells.length) submit({ t: "roof.paint", level: s.floor, cells, style: null });
}

function RoofPanel() {
  const roofStyle = useGame((s) => s.roofStyle);
  const erase = useGame((s) => s.roofErase);
  const has = useGame((s) => Object.keys(s.view?.levels[s.floor]?.roofs ?? {}).length > 0);
  return (
    <Floating id="tools" title="Roof" className="tool-panel">
      <div className="kicker">Roof</div>
      <div className="seg">
        <button className={!erase ? "on" : ""} onClick={() => useGame.setState({ roofErase: false })}>
          Add
        </button>
        <button className={erase ? "on" : ""} onClick={() => useGame.setState({ roofErase: true })}>
          Remove
        </button>
      </div>
      <div className="swatches">
        {[...catalog.roofStyles.values()].map((r) => (
          <Swatch key={r.id} color={r.color} label={r.name} active={!erase && roofStyle === r.id} onClick={() => useGame.setState({ roofStyle: r.id, roofErase: false })} />
        ))}
      </div>
      <div className="row-buttons">
        <button className="btn" onClick={roofHouse}>
          Roof the whole house
        </button>
        <button className="btn" onClick={clearRoof} disabled={!has}>
          Take it all off
        </button>
      </div>
      <p className="hint hand">{erase ? "Drag over the roof to take that part off." : "Drag a rectangle over the rooms. The roof slopes up from whatever edge it has, so any shape works."}</p>
    </Floating>
  );
}

function ToolPanel() {
  const tool = useGame((s) => s.tool);
  const placing = useGame((s) => s.placing);
  const [category, setCategory] = useState<Category>("living");
  const [query, setQuery] = useState("");
  // the colour picked for each item that comes in a few
  const [picked, setPicked] = useState<Record<string, string>>({});
  const funds = useGame((s) => s.view?.funds ?? 0);

  if (tool === "wall" || tool === "floor") return <MaterialPanel kind={tool} />;
  if (tool === "roof") return <RoofPanel />;
  if (tool === "wallErase" || tool === "floorErase")
    return (
      <Floating id="tools" title={tool === "wallErase" ? "Knock down walls" : "Lift the floor"} className="tool-panel slim">
        <p className="hint hand">{tool === "wallErase" ? "Drag along a wall to knock it down." : "Drag over tiles to lift the floor."}</p>
      </Floating>
    );
  if (tool === "buy") {
    const searching = Boolean(query.trim());
    const items: (FurnitureItem | OpeningItem)[] = searching
      ? searchCatalog([...catalog.furniture.values(), ...catalog.openings.values()], query)
      : category === "openings" ? [...catalog.openings.values()] : [...catalog.furniture.values()].filter((i) => i.category === category);
    const placingOpening = placing ? catalog.openings.has(placing.catalogId) : false;
    return (
      <Floating id="tools" title="Buy" icon={<Icon.coin />} className="tool-panel catalog">
        <div className="tabs">
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`tab ${!searching && category === c.id ? "active" : ""}`} aria-pressed={!searching && category === c.id} onClick={() => { setCategory(c.id); setQuery(""); }}>
              {c.label}
            </button>
          ))}
        </div>
        <CatalogSearch query={query} onChange={(q) => { setQuery(q); setPicked({}); }} count={items.length} />
        {searching && items.length === 0 && <p className="catalog-empty hand">Nothing found. Try “sofa”, “sink” or “window”, or clear your search.</p>}
        <div className="items" key={searching ? query : category}>
          {groupVariants(items).map((family) => {
            const f = familyOf(family[0]!);
            const placed = placing && (catalog.furniture.get(placing.catalogId) ?? catalog.openings.get(placing.catalogId));
            const placingHere = placed && familyOf(placed) === f ? placed.id : undefined;
            const shownId = placingHere ?? picked[f] ?? family[0]!.id;
            const i = catalog.furniture.get(shownId) ?? family[0]!;
            const pick = (id: string) => {
              setPicked({ ...picked, [f]: id });
              if (placingHere) useGame.setState({ placing: { catalogId: id, rot: placing!.rot } });
            };
            const card = (
              <button
                key={i.id}
                className={`item ${placing?.catalogId === i.id ? "active" : ""} ${i.price > funds ? "dear" : ""}`}
                title={i.price > funds ? `${i.price.toLocaleString()} coins: ${(i.price - funds).toLocaleString()} more than the house has` : undefined}
                onClick={() => useGame.setState({ placing: placing?.catalogId === i.id ? null : { catalogId: i.id, rot: 0 } })}
              >
                <ItemPicture item={i} />
                <span className="item-name">{i.name}</span>
                <span className="item-price">
                  <Icon.coin />
                  {i.price.toLocaleString()}
                </span>
              </button>
            );
            return colorsOf(i.id).length ? (
              <div key={f} className="item-family">
                {card}
                <VariantSwatches id={i.id} onPick={pick} />
              </div>
            ) : (
              card
            );
          })}
        </div>
        <p className="hint hand">
          {placingOpening
            ? "Point at a wall and click · R to face it the other way · Esc to stop"
            : placing
              ? "Click to place · R to turn · Esc to stop"
              : category === "openings"
                ? "Pick a door or window, then click on a wall."
                : category === "entertainment"
                  ? "Some pieces are decorative. Switch to Live for supported activities; leave space around game tables."
                  : "Pick something, then click on the lot."}
        </p>
      </Floating>
    );
  }
  return null;
}

function SelectionCard() {
  const selection = useGame((s) => s.selection);
  const o = useGame((s) => (s.selection ? (s.view?.levels[s.floor]?.objects[s.selection] ?? s.view?.levels[s.floor]?.openings[s.selection]) : undefined));
  if (!selection || !o) return null;
  const opening = catalog.openings.get(o.catalogId);
  const item = opening ?? catalog.furniture.get(o.catalogId);
  // doors and windows come back at full price; furniture sells for its resale value
  const back = item ? (opening ? item.price : resaleValue(item)) : 0;
  return (
    <Floating id="selection" title={item?.name ?? "Selected"} className="selection-card">
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
        <button className="btn danger" onClick={deleteSelected} title={item ? `${opening ? "Gives back" : `Sells for ${Math.round(RESALE * 100)}% of the price:`} ${back.toLocaleString()} coins` : undefined}>
          <Icon.trash /> {opening ? "Remove" : "Sell"}
          {item ? <span className="refund">+{back.toLocaleString()}</span> : null} <kbd>Del</kbd>
        </button>
      </div>
    </Floating>
  );
}

/** On an empty lot, offer the starter house. It arrives as one edit, so Undo takes it all away again. */
function StarterOffer() {
  const empty = useGame((s) => {
    const l = s.view?.levels[0];
    return Boolean(l) && !Object.keys(l!.walls).length && !Object.keys(l!.objects).length && !Object.keys(l!.tiles).length;
  });
  const online = useGame((s) => s.status === "online");
  const view = useGame((s) => s.view);
  // a fixed price, whatever the fresh IDs: work it out once per empty lot
  const cost = useMemo(() => (empty && view ? costOf(view, starterHouseOp()) : null), [empty, view]);
  if (!empty) return null;
  const short = cost !== null && view !== null && cost > view.funds;
  return (
    <Floating id="starter" title="Starter house" icon={<Icon.house />} className="starter-card">
      <div className="kicker">An empty lot</div>
      <p className="hand">Build from scratch, or start with a house you can change: two bedrooms, a bathroom, an open kitchen and living room, a garage and a pool.</p>
      <button className="btn primary" disabled={!online || short} onClick={() => submit(starterHouseOp())}>
        <Icon.house /> Build the starter house{cost !== null ? ` · ${cost.toLocaleString()} coins` : ""}
      </button>
      {short && <p className="hint hand">Its furniture costs more than the house has right now.</p>}
    </Floating>
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
    <Floating id="cooking" title={recipe.name} icon={<Icon.pot />} className="cooking-card">
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
    </Floating>
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
