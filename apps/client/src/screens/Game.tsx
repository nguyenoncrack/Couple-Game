import type { HouseSummary } from "@cg/shared";
import { useEffect } from "react";
import { LoadingScreen } from "./LoadingScreen";
import { Scene } from "../render/Scene";
import { act, checkIn, connect, disconnect, openChat, redo, setFirstPerson, setMode, setTool, undo, useGame, type Tool } from "../state/game";
import { wantMusic } from "../state/music";
import { cycleWallMode, Hud, TOOL_KEYS, toggleRoof } from "../ui/Hud";

export function Game({ house, onLeave }: { house: HouseSummary; onLeave: () => void }) {
  const ready = useGame((s) => s.view !== null);
  const status = useGame((s) => s.status);
  const goneReason = useGame((s) => s.goneReason);
  const dropReason = useGame((s) => s.dropReason);

  useEffect(() => {
    connect(house);
    return () => disconnect();
  }, [house.houseId]);

  useEffect(() => wantMusic(), []);

  // once the house is in view, the first thing I do (a click, a key) counts today's visit
  useEffect(() => {
    if (!ready) return;
    window.addEventListener("pointerdown", checkIn, true);
    window.addEventListener("keydown", checkIn, true);
    return () => {
      window.removeEventListener("pointerdown", checkIn, true);
      window.removeEventListener("keydown", checkIn, true);
    };
  }, [ready]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      // Enter or Space on a focused button presses it, rather than opening the chat
      if ((e.key === "Enter" || e.key === " ") && e.target instanceof HTMLElement && e.target.closest("button, a, select")) return;
      const k = e.key.toLowerCase();
      if (e.repeat && (k === "v" || k === "l" || k === "t" || k === "o")) return;
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
      if (e.key === "Enter" && !e.shiftKey && !e.repeat) {
        e.preventDefault();
        return openChat(true);
      }
      const s = useGame.getState();
      if (k === "l") return setMode(s.mode === "live" ? "build" : "live");
      if (k === "t") return cycleWallMode();
      if (k === "o") return toggleRoof();
      if (s.mode === "live") {
        if (k === "v") setFirstPerson(!s.firstPerson);
        else if (k === "f" && !s.firstPerson) useGame.setState({ follow: !s.follow });
        else if (k === "x") act({ do: "stop" });
        return;
      }
      const tool = TOOL_KEYS[e.key] as Tool | undefined;
      if (tool) setTool(tool);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  if (!ready) return <LoadingScreen
    houseName={house.houseName}
    message={status === "gone" ? "This door is closed" : status === "reconnecting" ? "Reconnecting to your home…" : "Unlocking the front door…"}
    detail={status === "gone" ? goneReason : status === "reconnecting" ? dropReason || "We’ll let you in as soon as the connection returns." : "Bringing your shared home into view."}
    failed={status === "gone"} onBack={onLeave}
  />;
  return (
    <div className="game">
      <Scene />
      <Hud onLeave={onLeave} />
    </div>
  );
}
