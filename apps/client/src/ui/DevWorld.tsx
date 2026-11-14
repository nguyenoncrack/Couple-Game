import { clockLabel, dayPhase, type WorldCmd } from "@cg/shared";
import { useEffect, useState } from "react";
import { serverNow, useGame, worldCmd } from "../state/game";
import "./devworld.css";

/**
 * Development controls for the day: jump the shared clock to sunrise, noon, sunset or midnight, and force rain or
 * clear skies (or hand the weather back to its own pattern). Only built into development; whatever you press is the
 * house's, so your partner's screen follows.
 */
const TIMES: { at: Extract<WorldCmd, { cmd: "time" }>["at"]; label: string }[] = [
  { at: "sunrise", label: "Sunrise" },
  { at: "noon", label: "Noon" },
  { at: "sunset", label: "Sunset" },
  { at: "midnight", label: "Midnight" },
];
const WEATHER: { set: Extract<WorldCmd, { cmd: "weather" }>["set"]; label: string }[] = [
  { set: "rain", label: "Rain" },
  { set: "clear", label: "Clear" },
  { set: "auto", label: "Auto" },
];

export function DevWorld() {
  const world = useGame((s) => s.life?.world);
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () => setLabel(clockLabel(dayPhase(serverNow(), world)));
    tick();
    const i = window.setInterval(tick, 500);
    return () => window.clearInterval(i);
  }, [world]);
  return (
    <div className="dev-world" aria-label="Day and weather (development)">
      <span className="dev-world-title">Dev · {label}</span>
      <div className="dev-world-row">
        {TIMES.map((t) => (
          <button key={t.at} onClick={() => worldCmd({ cmd: "time", at: t.at })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="dev-world-row">
        {WEATHER.map((t) => (
          <button key={t.set} className={world?.weather?.mode === t.set || (t.set === "auto" && !world?.weather) ? "on" : ""} onClick={() => worldCmd({ cmd: "weather", set: t.set })}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
