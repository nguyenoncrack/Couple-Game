import { CharacterButton } from "../features/character/CharacterButton";
import type { HouseSummary, Me } from "@cg/shared";
import { useState, type FormEvent } from "react";
import { ApiError, changePassword, createHouse, joinHouse, leaveHouse, signOut } from "../net/api";

interface HomeProps {
  me: Me;
  setMe: (me: Me) => void;
  initialCode?: string;
  notice?: string;
  onOpen: (houseId: string) => void;
  onAdded?: (house: HouseSummary) => void;
  onSignedOut: () => void;
}

/** Your houses, making a new one, joining your partner's with a code, and your account. */
export function Home({ me, setMe, initialCode, notice, onOpen, onAdded, onSignedOut }: HomeProps) {
  const [houseName, setHouseName] = useState("Our little house");
  const [starter, setStarter] = useState(true);
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const run = async (what: "create" | "join") => {
    setError(null);
    setBusy(what);
    try {
      const h = what === "create" ? await createHouse(houseName.trim() || "Our little house", starter) : await joinHouse(code);
      (onAdded ?? ((x: HouseSummary) => onOpen(x.houseId)))(h);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(null);
    }
  };

  const leave = async (h: HouseSummary) => {
    const alone = h.members.length <= 1;
    const ask = alone ? `Leave "${h.houseName}"? You're the only one in it, so it will be gone for good.` : `Leave "${h.houseName}"? Your partner keeps the house; you'd need the room code to come back.`;
    if (!window.confirm(ask)) return;
    try {
      await leaveHouse(h.houseId);
      setMe({ ...me, houses: me.houses.filter((x) => x.houseId !== h.houseId) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
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

      <div className="account-bar">
        <CharacterButton onSaved={(appearance) => setMe({ ...me, account: { ...me.account, appearance } })} />
        <span className="hand">
          Hi, <b>{me.account.name}</b>
        </span>
        <button className="text-btn hand" onClick={() => setAccountOpen(!accountOpen)}>
          {accountOpen ? "close" : "account"}
        </button>
        <button
          className="text-btn hand"
          onClick={() => {
            void signOut().finally(onSignedOut);
          }}
        >
          sign out
        </button>
      </div>

      {accountOpen && <AccountCard onDone={() => setAccountOpen(false)} />}
      {notice && <div className="card notice hand">{notice}</div>}

      {me.houses.length > 0 && !initialCode && (
        <section className="saved">
          <div className="kicker">Your houses</div>
          <div className="saved-list">
            {me.houses.map((h) => (
              <div key={h.houseId} className="card saved-house">
                <button className="saved-open" onClick={() => onOpen(h.houseId)}>
                  <span className="saved-name">{h.houseName}</span>
                  <span className="saved-who">
                    {h.members.map((m) => (
                      <span key={m.name} className="saved-member hand" style={{ color: m.color }}>
                        {m.me ? "you" : m.name}
                      </span>
                    ))}
                    {h.members.length < 2 && <span className="kicker">code {h.inviteCode}</span>}
                  </span>
                </button>
                <button className="saved-forget" title="Leave this house" onClick={() => void leave(h)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="home-grid">
        {initialCode ? (
          <div className="card home-card accent">
            <div className="kicker">You've been invited</div>
            <h2>Join with code</h2>
            <input className="code-input" value={code} maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KX4-29P" />
            <button className="btn primary big" disabled={busy !== null} onClick={() => void run("join")}>
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
              <div className="lot-choice">
                <button className={`choice${starter ? " on" : ""}`} onClick={() => setStarter(true)}>
                  <b>Starter house</b>
                  <span className="hand">2 bedrooms, bath, kitchen, garage, pool</span>
                </button>
                <button className={`choice${!starter ? " on" : ""}`} onClick={() => setStarter(false)}>
                  <b>Empty lot</b>
                  <span className="hand">build it from scratch</span>
                </button>
              </div>
              <button className="btn primary big" disabled={busy !== null} onClick={() => void run("create")}>
                {busy === "create" ? "Building…" : "Make our house"}
              </button>
            </div>
            <div className="card home-card">
              <h2>Join your partner</h2>
              <label className="field">
                <span className="kicker">Room code</span>
                <input className="code-input" value={code} maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KX4-29P" />
              </label>
              <button className="btn big" disabled={busy !== null || code.replace(/[^A-Z0-9]/gi, "").length < 6} onClick={() => void run("join")}>
                {busy === "join" ? "Joining…" : "Join"}
              </button>
            </div>
          </>
        )}
      </div>

      {error && <div className="error hand">{error}</div>}
    </div>
  );
}

/** Change your password; anywhere else you're signed in is signed out. */
function AccountCard({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setMessage({ ok: false, text: "New passwords need at least 8 characters." });
    setBusy(true);
    try {
      await changePassword(current, next);
      setMessage({ ok: true, text: "Changed. Anywhere else you were signed in has been signed out." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card home-card auth-card" onSubmit={submit}>
      <h2>Change password</h2>
      <label className="field">
        <span className="kicker">Current password</span>
        <input type="password" autoComplete="current-password" value={current} maxLength={200} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span className="kicker">New password</span>
        <input type="password" autoComplete="new-password" value={next} maxLength={200} onChange={(e) => setNext(e.target.value)} placeholder="at least 8 characters" />
      </label>
      {message && <div className={message.ok ? "hand" : "error hand"}>{message.text}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Change it"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
      </div>
    </form>
  );
}
