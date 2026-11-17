import { DEFAULT_LIGHTS, PARTY_COLORS, PRESETS, type PartyLights } from "@cg/shared";
import type { CSSProperties } from "react";
import { steadyFor } from "../../../render/party/partyMaterials";
import { partyCmd, useGame } from "../../../state/game";
import { useSlider } from "../partyHooks";

/** The console's lights page: the house's party lights, worked from the booth (or a music player). Shared. */

const setLights = (set: Partial<PartyLights>) => partyCmd({ cmd: "lights", set });

export function LightsPage() {
  const lights = useGame((s) => s.life?.party?.lights ?? DEFAULT_LIGHTS);
  const brightness = useSlider(lights.brightness, (v) => setLights({ brightness: v }));
  const spread = useSlider(lights.spread, (v) => setLights({ spread: v }));
  const forced = steadyFor({ steady: false });
  const steady = lights.steady || forced;
  const tint = lights.color ?? PRESETS.find((p) => p.id === lights.preset)?.palette[0] ?? "#ffd166";
  return (
    <div className="dj-lights" style={{ "--tint": tint } as CSSProperties}>
      <div className="dj-mixer">
        <button className={`dj-pad dj-lamp ${lights.on ? "on" : ""}`} onClick={() => setLights({ on: !lights.on })} aria-pressed={lights.on}>
          <span className="dj-lamp-dot" aria-hidden />
          {lights.on ? "Lights on" : "Lights off"}
        </button>
        <label className="dj-fader dj-level">
          <span className="dj-label">Bright</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(brightness.value * 100)}
            onChange={(e) => brightness.onChange(Number(e.target.value) / 100)}
            onPointerUp={brightness.onRelease}
            onKeyUp={brightness.onRelease}
            onBlur={brightness.onRelease}
            aria-label="Brightness"
          />
        </label>
        <label className="dj-fader dj-level">
          <span className="dj-label">Lasers</span>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={Math.round(spread.value * 100)}
            onChange={(e) => spread.onChange(Number(e.target.value) / 100)}
            onPointerUp={spread.onRelease}
            onKeyUp={spread.onRelease}
            onBlur={spread.onRelease}
            aria-label="Laser spread"
          />
        </label>
        <button className={`dj-chip ${steady ? "on" : ""}`} onClick={() => setLights({ steady: !lights.steady })} disabled={forced} aria-pressed={steady} title={forced ? "Your device asks for less motion" : "Hold the colours still"}>
          Steady
        </button>
      </div>

      <div className="dj-label dj-heading">Look</div>
      <div className="dj-looks">
        {PRESETS.map((p) => {
          const active = lights.preset === p.id && !lights.color;
          return (
            <button key={p.id} className={`dj-sleeve dj-look ${active ? "loaded" : ""}`} style={{ "--c": p.palette[0], "--strip": `linear-gradient(90deg, ${p.palette.join(", ")})` } as CSSProperties} onClick={() => setLights({ preset: p.id })} aria-pressed={active}>
              <span className="dj-look-strip" aria-hidden />
              <span className="dj-sleeve-name">{p.name}</span>
            </button>
          );
        })}
      </div>

      <div className="dj-label dj-heading">One colour</div>
      <div className="dj-swatches">
        {PARTY_COLORS.map((c) => (
          <button key={c.color} className={`dj-swatch ${lights.color === c.color ? "on" : ""}`} style={{ "--c": c.color } as CSSProperties} title={c.name} aria-label={c.name} aria-pressed={lights.color === c.color} onClick={() => setLights({ color: lights.color === c.color ? null : c.color })} />
        ))}
      </div>
      <p className="dj-note dj-hint">Colours drift slowly and nothing flashes.</p>
    </div>
  );
}
