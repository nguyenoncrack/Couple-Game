import { useState } from "react";
import { ApiError, createHouse, joinHouse, type JoinedHouse } from "../net/api";
import { forgetHouse, lastPlayerName, rememberPlayerName, savedHouses, saveHouse } from "../net/session";

/** Make a house, join one with a code, or reopen one you belong to. */
export function Home({ initialCode, notice, onOpen }: { initialCode?: string; notice?: string; onOpen: (houseId: string) => void }) {
  const [name, setName] = useState(lastPlayerName());
  const [houseName, setHouseName] = useState("Our little house");
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [houses, setHouses] = useState(savedHouses());

  const done = (h: JoinedHouse) => {
    rememberPlayerName(name.trim());
    saveHouse({ ...h, lastOpened: Date.now() });
    onOpen(h.houseId);
  };

  const run = async (what: "create" | "join") => {
    setError(null);
    if (!name.trim()) return setError("Pop your name in first.");
    setBusy(what);
    try {
      done(what === "create" ? await createHouse(houseName.trim() || "Our little house", name.trim()) : await joinHouse(code, name.trim()));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="home">
      <header className="home-head">
        <h1 className="wordmark">
          Home <span>for</span> Two
        </h1>
        <p className="hand tagline">Build a little house together, from two screens.</p>
      </header>

      {notice && <div className="card notice hand">{notice}</div>}

      <div className="home-grid">
        <div className="card home-card">
          <label className="field">
            <span className="kicker">Your name</span>
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoFocus={!initialCode} />
          </label>
        </div>

        {initialCode ? (
          <div className="card home-card accent">
            <div className="kicker">You've been invited</div>
            <h2>Join with code</h2>
            <input className="code-input" value={code} maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KX4-29P" />
            <button className="btn primary big" disabled={busy !== null} onClick={() => run("join")}>
              {busy === "join" ? "Joining…" : "Join the house"}
            </button>
          </div>
        ) : (
          <>
            <div className="card home-card">
              <h2>Start a new house</h2>
              <label className="field">
                <span className="kicker">House name</span>
                <input value={houseName} maxLength={24} onChange={(e) => setHouseName(e.target.value)} />
              </label>
              <button className="btn primary big" disabled={busy !== null} onClick={() => run("create")}>
                {busy === "create" ? "Building…" : "Make our house"}
              </button>
            </div>
            <div className="card home-card">
              <h2>Join your partner</h2>
              <label className="field">
                <span className="kicker">Room code</span>
                <input className="code-input" value={code} maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KX4-29P" />
              </label>
              <button className="btn big" disabled={busy !== null || code.replace(/[^A-Z0-9]/gi, "").length < 6} onClick={() => run("join")}>
                {busy === "join" ? "Joining…" : "Join"}
              </button>
            </div>
          </>
        )}
      </div>

      {error && <div className="error hand">{error}</div>}

      {houses.length > 0 && (
        <section className="saved">
          <div className="kicker">Your houses</div>
          <div className="saved-list">
            {houses.map((h) => (
              <div key={h.houseId} className="card saved-house">
                <button className="saved-open" onClick={() => onOpen(h.houseId)}>
                  <span className="saved-name">{h.houseName}</span>
                  <span className="kicker">code {h.inviteCode}</span>
                </button>
                <button
                  className="saved-forget"
                  title="Forget on this device"
                  onClick={() => {
                    forgetHouse(h.houseId);
                    setHouses(savedHouses());
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
