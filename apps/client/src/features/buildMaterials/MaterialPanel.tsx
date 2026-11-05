import { catalog } from "@cg/shared";
import { Floating } from "../../ui/Floating";
import { useGame } from "../../state/game";
import { useMaterialPreview } from "./previews";
import { materialDefinition, type MaterialKind } from "./material";
import { useMaterialTools, type PaintScope } from "./tools";
import "./materials.css";

export function MaterialPanel({ kind }: { kind: MaterialKind }) {
  const id = useGame((s) => kind === "wall" ? s.wallStyle : s.floorMaterial), floor = useGame((s) => s.floor);
  const scope = useMaterialTools((s) => s[kind]), selected = materialDefinition(kind, id);
  const items = kind === "wall" ? catalog.wallStyles : catalog.floorMaterials;
  const scopes: [PaintScope, string][] = [["draw", kind === "wall" ? "Draw walls" : "Lay tiles"], ["surface", kind === "wall" ? "Segment" : "Tile"], ["room", "Room"]];
  return <Floating id="tools" title={kind === "wall" ? "Wall materials" : "Floor materials"} className="tool-panel material-panel">
    <div className="kicker">{kind === "wall" ? "Wall materials" : "Floor materials"} · Floor {floor + 1}</div>
    <div className="material-scope" role="group" aria-label="Apply material to">{scopes.map(([value, label]) => <button type="button" className={scope === value ? "active" : ""} aria-pressed={scope === value} key={value} onClick={() => useMaterialTools.setState({ [kind]: value })}>{label}</button>)}</div>
    <p className="material-instructions" aria-live="polite">{scope === "draw" ? kind === "wall" ? "Drag along grid lines to build or restyle walls." : "Drag a rectangle to lay or repaint floor tiles." : scope === "room" ? "Click inside an enclosed room. Existing surfaces change; openings and empty floor spaces stay clear." : kind === "wall" ? "Click one wall segment to change its finish." : "Click an existing floor tile to change its finish."}</p>
    <div className="material-cards" role="group" aria-label={kind === "wall" ? "Wall finishes" : "Floor finishes"}>{[...items.values()].map((item) => <MaterialCard key={item.id} kind={kind} id={item.id} active={id === item.id} />)}</div>
    <div className="material-selection"><strong>{selected.name}</strong><p>{selected.description ?? "A matching finish for your home."}</p><span>Patterns stay aligned across adjacent surfaces. Undo works as usual.</span></div>
  </Floating>;
}
function MaterialCard({ kind, id, active }: { kind: MaterialKind; id: string; active: boolean }) {
  const definition = materialDefinition(kind, id), url = useMaterialPreview(kind, id);
  return <button type="button" className={`material-card ${active ? "active" : ""}`} aria-label={definition.name} aria-pressed={active} onClick={() => useGame.setState(kind === "wall" ? { wallStyle: id } : { floorMaterial: id })}>
    <span className="material-picture" style={{ backgroundColor: definition.color }}>{url && <img src={url} alt="" />}{active && <span className="material-check" aria-hidden="true">✓</span>}</span><span>{definition.name}</span>
  </button>;
}
