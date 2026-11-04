import { useEffect, useRef, useState, type ReactNode } from "react";
import { CharacterButton } from "../features/character/CharacterButton";
import { openChat, useGame } from "../state/game";
import { setMusic, useMusicOn } from "../state/music";
import { Icon } from "./icons";
import "./phone.css";

/**
 * Everything that isn't the house itself, tucked into a phone in the corner: who's home, inviting your partner,
 * your character, chat, sound and the controls. One button on screen instead of a row of them.
 */

function App({ icon, label, badge, on, onClick }: { icon: ReactNode; label: string; badge?: number; on?: boolean; onClick: () => void }) {
  return (
    <button className={`phone-app ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="phone-app-icon">
        {icon}
        {badge ? <span className="unread">{badge > 9 ? "9+" : badge}</span> : null}
      </span>
      <span className="phone-app-label">{label}</span>
    </button>
  );
}

export function Phone({ onInvite, onHelp }: { onInvite: () => void; onHelp: () => void }) {
  const [open, setOpen] = useState(false);
  const members = useGame((s) => s.members);
  const me = useGame((s) => s.me);
  const online = useGame((s) => s.status === "online");
  const unread = useGame((s) => s.unread);
  const music = useMusicOn();
  const partner = members.find((m) => m.id !== me);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => new Date());

  // closes on Esc or a click anywhere else; not while the wardrobe (opened from in here) is up
  useEffect(() => {
    if (!open) return;
    const busy = () => Boolean(box.current?.querySelector("dialog[open]"));
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (busy() || box.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy()) return;
      setOpen(false);
      button.current?.focus();
    };
    const tick = window.setInterval(() => setNow(new Date()), 10_000);
    setNow(new Date());
    box.current?.querySelector<HTMLElement>(".phone-app")?.focus();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  /** Opening an app puts the phone away. */
  const go = (then: () => void) => () => {
    setOpen(false);
    then();
  };

  return (
    <>
      <button
        ref={button}
        className={`pill icon-pill phone-pill ${open ? "on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread ? `Phone, ${unread} unread` : "Phone"}
        title="Phone"
      >
        <Icon.phone />
        {unread > 0 && !open && <span className="unread">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div ref={box} className="card phone" role="dialog" aria-label="Phone">
          <div className="phone-status" aria-hidden>
            <span>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            <span className="phone-notch" />
            <span className={`phone-signal ${online ? "" : "off"}`} />
          </div>
          <ul className="phone-people" aria-label="Who's home">
            {members.map((m) => (
              <li key={m.id} className={m.online ? "" : "away"}>
                <span className="avatar" style={{ background: m.color }}>
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="phone-name">{m.name}</span>
                <span className="phone-where">{m.id === me ? "you" : m.online ? "here now" : "away"}</span>
              </li>
            ))}
          </ul>
          <div className="phone-apps">
            <App icon={<Icon.chat />} label="Chat" badge={unread} onClick={go(() => openChat(true))} />
            <App icon={<Icon.link />} label={partner ? "Room code" : "Invite"} onClick={go(onInvite)} />
            <CharacterButton
              className="phone-app"
              disabled={!online}
              onSaved={(appearance) => useGame.setState((s) => ({ members: s.members.map((m) => (m.id === s.me ? { ...m, appearance } : m)) }))}
            >
              <span className="phone-app-icon">
                <Icon.person />
              </span>
              <span className="phone-app-label">Character</span>
            </CharacterButton>
            <App icon={music ? <Icon.music /> : <Icon.musicOff />} label={music ? "Sound on" : "Sound off"} on={music} onClick={() => setMusic(!music)} />
            <App icon={<Icon.help />} label="Controls" onClick={go(onHelp)} />
          </div>
        </div>
      )}
    </>
  );
}
