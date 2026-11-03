import { CHAT_MAX } from "@cg/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { openChat, say, useGame } from "../state/game";
import { Icon } from "./icons";

/**
 * Talking in the house. What you say shows in a bubble over your head (see Characters) and here, with the last
 * things said kept for when you come back. Enter opens it; Esc closes it.
 */

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function ChatButton() {
  const open = useGame((s) => s.chatOpen);
  const unread = useGame((s) => s.unread);
  return (
    <button className={`pill icon-pill chat-pill ${open ? "on" : ""}`} onClick={() => openChat(!open)} title="Chat (Enter)">
      <Icon.chat />
      {unread > 0 && <span className="unread">{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}

export function ChatPanel() {
  const open = useGame((s) => s.chatOpen);
  const chat = useGame((s) => s.chat);
  const members = useGame((s) => s.members);
  const me = useGame((s) => s.me);
  const online = useGame((s) => s.status === "online");
  const partner = members.find((m) => m.id !== me);
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, open]);

  if (!open) return null;

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    say(text);
    setText("");
  };

  return (
    <div className="card chat-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="chat-head">
        <span className="kicker">{partner ? `You and ${partner.name}` : "Just you so far"}</span>
        <button className="close" onClick={() => openChat(false)} aria-label="Close chat">
          ×
        </button>
      </div>
      <div className="chat-list" ref={list}>
        {chat.length === 0 && <p className="chat-empty hand">Say hello. It pops up over your head, too.</p>}
        {chat.map((m) => {
          const who = members.find((x) => x.id === m.by);
          const mine = m.by === me;
          return (
            <div key={m.id} className={`chat-line ${mine ? "mine" : ""}`}>
              <div className="chat-bubble" style={{ borderColor: who?.color }}>
                {m.text}
              </div>
              <span className="chat-meta">
                {mine ? "you" : (who?.name ?? "someone")} · {clock(m.at)}
              </span>
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input
          ref={input}
          value={text}
          maxLength={CHAT_MAX}
          placeholder={online ? "Say something…" : "Reconnecting…"}
          disabled={!online}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              openChat(false);
            }
          }}
        />
        <button className="btn primary" disabled={!online || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
