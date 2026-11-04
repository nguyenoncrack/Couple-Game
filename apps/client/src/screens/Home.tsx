import { CharacterButton } from "../features/character/CharacterButton";
import type { HouseSummary, Me } from "@cg/shared";
import { useState, type FormEvent } from "react";
import { ApiError, changePassword, createHouse, joinHouse, leaveHouse, signOut } from "../net/api";
import { Cover, CoverTitle, HomePanel } from "./Cover";

interface HomeProps {
  me: Me;
  setMe: (me: Me) => void;
  initialCode?: string;
  notice?: string;
  onOpen: (houseId: string) => void;
  onAdded?: (house: HouseSummary) => void;
  onSignedOut: () => void;
}

type Panel = "houses" | "create" | "join" | "account" | null;

/** The front cover keeps the menu calm; house and account tools open on their own paper panels. */
export function Home({ me, setMe, initialCode, notice, onOpen, onAdded, onSignedOut }: HomeProps) {
  const [houseName, setHouseName] = useState("Our little house");
  const [starter, setStarter] = useState(true);
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(initialCode ? "join" : null);
  const [signingOut, setSigningOut] = useState(false);
  const firstHouse = me.houses[0];
  const openPanel = (next: Panel) => { setError(null); setPanel(next); };
  const closePanel = () => { setError(null); setPanel(null); };

  const run = async (what: "create" | "join") => {
    if (busy) return;
    setError(null);
    setBusy(what);
    try {
      const h = what === "create" ? await createHouse(houseName.trim() || "Our little house", starter) : await joinHouse(code);
      (onAdded ?? ((x: HouseSummary) => onOpen(x.houseId)))(h);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally { setBusy(null); }
  };

  const leave = async (h: HouseSummary) => {
    const alone = h.members.length <= 1;
    const ask = alone ? `Leave "${h.houseName}"? You're the only one in it, so it will be gone for good.` : `Leave "${h.houseName}"? Your partner keeps the house; you'd need the room code to come back.`;
    if (!window.confirm(ask)) return;
    try {
      await leaveHouse(h.houseId);
      setMe({ ...me, houses: me.houses.filter((x) => x.houseId !== h.houseId) });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong."); }
  };

  return <Cover className="menu-cover">
    <div className="cover-content">
      <CoverTitle />
      <p className="cover-greeting">Welcome home, <b>{me.account.name}.</b></p>
      {notice && <p className="cover-notice" role="status">{notice}</p>}
      <nav className="cover-menu" aria-label="Main menu">
        <button className="cover-continue" onClick={() => firstHouse ? onOpen(firstHouse.houseId) : openPanel("create")}>
          <span><strong>{firstHouse ? "Continue" : "Start our story"}</strong><small>{firstHouse ? firstHouse.houseName : "Make a little place of your own"}</small></span>
          <span className="menu-arrow" aria-hidden="true">↗</span>
        </button>
        {me.houses.length > 0 && <button className="cover-menu-item" onClick={() => openPanel("houses")}>Your houses <span className="menu-count">{me.houses.length}</span></button>}
        <button className="cover-menu-item" onClick={() => openPanel("create")}>Start a new house <span aria-hidden="true">+</span></button>
        <button className="cover-menu-item" onClick={() => openPanel("join")}>Join your partner <span aria-hidden="true">↗</span></button>
        <div className="cover-character"><CharacterButton onSaved={(appearance) => setMe({ ...me, account: { ...me.account, appearance } })} /></div>
      </nav>
      <footer className="cover-footer">
        <button className="text-btn" onClick={() => openPanel("account")}>Account</button>
        <span aria-hidden="true">·</span>
        <button className="text-btn" disabled={signingOut} onClick={() => {
          setSigningOut(true);
          void signOut().then(onSignedOut).catch((e) => { setError(e instanceof ApiError ? e.message : "Couldn’t sign out. Try again."); setSigningOut(false); });
        }}>{signingOut ? "Signing out…" : "Sign out"}</button>
      </footer>
      {error && !panel && <p className="error" role="alert">{error}</p>}
      <p className="cover-footnote">Two people. One place to call home.</p>
    </div>

    {panel === "houses" && <HomePanel title="Your houses" onClose={closePanel}>
      <p className="panel-intro">Pick up where you left off.</p>
      <div className="cover-house-list">
        {me.houses.length === 0 && <p>No houses yet. Start a new one or join your partner.</p>}
        {me.houses.map((h) => <div key={h.houseId} className="cover-house">
          <button className="saved-open" onClick={() => onOpen(h.houseId)}>
            <span className="saved-name">{h.houseName}</span>
            <span className="saved-who">{h.members.map((m) => <span key={m.name} className="saved-member" style={{ color: m.color }}>{m.me ? "you" : m.name}</span>)}</span>
            {h.members.length < 2 && <span className="kicker">Room code {h.inviteCode}</span>}
          </button>
          <button className="saved-forget" aria-label={`Leave ${h.houseName}`} title="Leave this house" onClick={() => void leave(h)}>×</button>
        </div>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </HomePanel>}

    {(panel === "create" || panel === "join") && <HomePanel title={panel === "create" ? "Start a new house" : initialCode ? "You’re invited" : "Join your partner"} onClose={closePanel}>
      <form className="cover-form" onSubmit={(e) => { e.preventDefault(); void run(panel); }}>
        {panel === "create" ? <>
          <p className="panel-intro">A ready-made nest, or a blank page. Your home starts here.</p>
          <label className="field"><span className="kicker">House name</span><input value={houseName} maxLength={24} onChange={(e) => setHouseName(e.target.value)} /></label>
          <div className="lot-choice" role="group" aria-label="Starting house">
            <button type="button" aria-pressed={starter} className={`choice${starter ? " on" : ""}`} onClick={() => setStarter(true)}><b>Starter house</b><span>2 bedrooms, bath, kitchen, garage, pool</span></button>
            <button type="button" aria-pressed={!starter} className={`choice${!starter ? " on" : ""}`} onClick={() => setStarter(false)}><b>Empty lot</b><span>Build it from scratch</span></button>
          </div>
        </> : <>
          <p className="panel-intro">{initialCode ? "Your partner left the door open for you." : "Every little home has room for two. Ask your partner for the room code."}</p>
          <label className="field"><span className="kicker">Room code</span><input className="code-input" value={code} maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KX4-29P" /></label>
        </>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary big" disabled={busy !== null || (panel === "join" && code.replace(/[^A-Z0-9]/gi, "").length < 6)}>
          {busy ? panel === "create" ? "Building…" : "Joining…" : panel === "create" ? "Make our house" : "Join the house"}
        </button>
      </form>
    </HomePanel>}
    {panel === "account" && <HomePanel title="Your account" onClose={closePanel}><AccountCard onDone={closePanel} /></HomePanel>}
  </Cover>;
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
