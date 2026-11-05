import { MAX_LEVELS } from "@cg/shared";
import { useEffect } from "react";
import { floorNow, setFloor, setTool, submit, toast, useGame } from "../state/game";
import { Icon } from "./icons";

/**
 * Which floor you're looking at, top floor first: floors above it are hidden. While building there's a button to
 * add a floor on top, and one to take the top floor away again once it's bare. Page Up and Page Down go up and down.
 */

const isBare = (l: { walls: object; tiles: object; objects: object; openings: object; roofs: object }) =>
  [l.walls, l.tiles, l.objects, l.openings, l.roofs].every((r) => Object.keys(r).length === 0);

const STAIRS = "stairs_oak";
const LIFT = "lift_glass";

export const floorName = (i: number) => (i === 0 ? "Ground floor" : `Floor ${i + 1}`);

export function FloorPicker() {
  const levels = useGame((s) => s.view?.levels);
  const floor = useGame((s) => s.floor);
  const building = useGame((s) => s.mode === "build");
  const placing = useGame((s) => s.placing?.catalogId);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "PageUp") setFloor(floorNow() + 1);
      else if (e.key === "PageDown") setFloor(floorNow() - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  if (!levels || (levels.length < 2 && !building)) return null;
  const top = levels.length - 1;

  const add = () => {
    submit({ t: "level.add", level: levels.length });
    setFloor(levels.length);
    toast(`${floorName(levels.length)} added. Lay some floor to stand on, then put stairs on the floor below.`);
  };
  // stairs or a lift, ready to put down (a lift goes on the ground floor, wherever you put it)
  const pick = (catalogId: string, hint: string) => {
    setTool("buy");
    useGame.setState({ placing: { catalogId, rot: 0 }, catalogOpen: false });
    toast(hint);
  };
  const remove = () => {
    if (!isBare(levels[top]!)) {
      toast(`Clear everything off ${floorName(top).toLowerCase()} before taking it away.`);
      return;
    }
    setFloor(top - 1);
    submit({ t: "level.remove", level: top });
  };

  return (
    <div className="floor-picker card" role="group" aria-label="Floors">
      {building && levels.length < MAX_LEVELS && (
        <button className="floor-add" onClick={add} title="Add a floor on top">
          +
        </button>
      )}
      {[...levels.keys()].reverse().map((i) => (
        <button key={i} className={`floor-btn ${i === floor ? "on" : ""}`} onClick={() => setFloor(i)} aria-pressed={i === floor} title={`${floorName(i)} (Page Up / Page Down)`}>
          {i === 0 ? "G" : i + 1}
        </button>
      ))}
      {building && top > 0 && (
        <button className="floor-add" onClick={remove} title={`Take ${floorName(top).toLowerCase()} away (it has to be empty)`}>
          −
        </button>
      )}
      {building && top > 0 && (
        <>
          <span className="floor-sep" aria-hidden />
          <button className={`floor-add ${placing === STAIRS ? "on" : ""}`} onClick={() => pick(STAIRS, floor < top ? `Stairs up to ${floorName(floor + 1).toLowerCase()}: R turns them, and floor's laid at the top if it's missing.` : "Stairs go on the floor below the one they reach: go down a floor first.")} title="Put in stairs, up to the floor above">
            <Icon.stairs />
          </button>
          <button className={`floor-add ${placing === LIFT ? "on" : ""}`} onClick={() => pick(LIFT, "A lift: it stands on the ground floor and stops on every floor with floor at its doors. R turns it.")} title="Put in a lift, through every floor">
            <Icon.lift />
          </button>
        </>
      )}
    </div>
  );
}
