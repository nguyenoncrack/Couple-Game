import type { Me } from "@cg/shared";
import { useState, type FormEvent } from "react";
import { ApiError, signIn, signUp } from "../net/api";
import { deviceClaims, forgetDeviceClaims, lastPlayerName, rememberPlayerName } from "../net/session";

/** Sign in, or make an account: a name and a password. Houses this browser joined before accounts come along. */
export function SignIn({ inviteCode, onSignedIn }: { inviteCode?: string; onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<"in" | "up">(lastPlayerName() ? "in" : "up");
  const [name, setName] = useState(lastPlayerName());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasOldHouses = deviceClaims().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Your name needs at least 2 letters.");
    if (mode === "up" && password.length < 8) return setError("Pick a password of at least 8 characters.");
    setBusy(true);
    try {
      const me = await (mode === "up" ? signUp : signIn)(name.trim(), password, deviceClaims());
      forgetDeviceClaims();
      rememberPlayerName(me.account.name);
      onSignedIn(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
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

      {inviteCode && <div className="card notice hand">You've been invited to a house. Sign in or make an account, and you'll go straight in.</div>}
      {hasOldHouses && <div className="card notice hand">Houses you played here before will move to your account.</div>}

      <form className="card home-card auth-card" onSubmit={submit}>
        <h2>{mode === "up" ? "Make an account" : "Welcome back"}</h2>
        <label className="field">
          <span className="kicker">Your name</span>
          <input value={name} maxLength={24} autoComplete="username" onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoFocus={!name} />
        </label>
        <label className="field">
          <span className="kicker">Password</span>
          <input
            type="password"
            value={password}
            maxLength={200}
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "up" ? "at least 8 characters" : ""}
            autoFocus={Boolean(name)}
          />
        </label>
        {error && <div className="error hand">{error}</div>}
        <button className="btn primary big" disabled={busy}>
          {busy ? "One moment…" : mode === "up" ? "Make my account" : "Sign in"}
        </button>
        <button
          type="button"
          className="text-btn hand"
          onClick={() => {
            setMode(mode === "up" ? "in" : "up");
            setError(null);
          }}
        >
          {mode === "up" ? "Already have an account? Sign in" : "New here? Make an account"}
        </button>
      </form>
    </div>
  );
}
