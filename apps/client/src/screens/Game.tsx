import { useEffect } from "react";
import type { SavedHouse } from "../net/session";
import { Scene } from "../render/Scene";
import { connect, disconnect, redo, setTool, undo, useGame, type Tool } from "../state/game";
import { cycleWallMode, Hud, TOOL_KEYS } from "../ui/Hud";

export function Game({ house, onLeave }: { house: SavedHouse; onLeave: () => void }) {
  const ready = useGame((s) => s.view !== null);

  useEffect(() => {
    connect(house);
    return () => disconnect();
  }, [house.houseId, house.token]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (k === "y") {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.altKey) return;
      const tool = TOOL_KEYS[e.key] as Tool | undefined;
      if (tool) setTool(tool);
      else if (k === "t") cycleWallMode();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <div className="game">
      {ready ? <Scene /> : <div className="loading hand">Unlocking the front door…</div>}
      <Hud onLeave={onLeave} />
    </div>
  );
}
