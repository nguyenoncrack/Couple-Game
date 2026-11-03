import { arrivalTime, blackjackScore, cardLabel, type BlackjackCommand } from "@cg/shared";
import { useEffect, useReducer } from "react";
import { act, serverNow, useGame } from "../state/game";
import "./table-games.css";

function Cards({ cards }: { cards: number[] }) {
  return <div className="table-hand">{cards.map((card) => {
    const { rank, suit, red } = cardLabel(card);
    return <span key={card} className={`playing-card ${red ? "red-suit" : ""}`} aria-label={`${rank} ${suit}`}><b>{rank}</b><span>{suit}</span></span>;
  })}</div>;
}

export function TableGamePanel() {
  const life = useGame((s) => s.life);
  const me = useGame((s) => s.me);
  const members = useGame((s) => s.members);
  const mine = me ? life?.avatars[me] : undefined;
  const use = mine?.use;
  const active = use?.action === "blackjack" || use?.action === "pingpong";
  const tableId = active ? use.objectId : null;
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const players = life ? Object.values(life.avatars).filter((a) => a.use?.objectId === tableId && a.use?.action === use?.action && members.some((m) => m.id === a.memberId && m.online)) : [];
  useEffect(() => {
    if (!tableId || !players.length) return;
    const left = Math.max(...players.map(arrivalTime)) - serverNow();
    if (left <= 0) return;
    const timer = window.setTimeout(redraw, left + 25);
    return () => window.clearTimeout(timer);
  }, [life, tableId, members]); // arrivals don't require polling or server ticks
  if (!active || !life || !me || !tableId || !mine) return null;
  const arrived = arrivalTime(mine) <= serverNow();
  const ready = arrived && players.every((a) => arrivalTime(a) <= serverNow());
  if (use.action === "pingpong") return <div className="card table-game-panel slim">
    <div className="kicker">PING-PONG</div>
    <h3>{!arrived ? "Heading to the table…" : players.length > 1 && ready ? "A rally for two" : "Serve practice"}</h3>
    <p className="hand">{players.length > 1 ? ready ? "Your partner's here. Keep the ball going together." : "Your partner is joining the other side." : "Your partner can click the table to join the other end."}</p>
    <button className="btn" onClick={() => act({ do: "stop" })}>Leave table</button>
  </div>;
  const round = life.blackjack?.[tableId];
  const hand = round?.hands[me];
  const send = (action: BlackjackCommand) => act({ do: "cards", objectId: tableId, roundId: round?.id ?? null, action });
  return <div className="card table-game-panel" aria-label="Blackjack game">
    <div className="kicker">AT THE CARD TABLE</div><h3>Blackjack for two</h3>
    {(!arrived || ((!round || round.phase === "finished") && !ready)) && <p className="hand">{arrived ? "Waiting for your partner to reach the table…" : "Walking to the table…"}</p>}
    {round ? <>
      <div className="table-player-title">Dealer <span>{blackjackScore(round.dealer)}{round.phase === "playing" ? " showing" : ""}</span></div>
      <div className="table-hand"><Cards cards={round.dealer} />{round.phase === "playing" && <span className="playing-card card-back" aria-label="Dealer draws at reveal">?</span>}</div>
      {Object.entries(round.hands).map(([id, h]) => <section className="table-player" key={id}>
        <div className="table-player-title">{id === me ? "You" : members.find((m) => m.id === id)?.name ?? "Your partner"}<span>{blackjackScore(h.cards)} · {h.result ? ({ win: "Win!", lose: "Dealer wins", push: "Push" }[h.result]) : h.status === "playing" ? "Playing" : h.status === "left" ? "Left table" : h.status === "blackjack" ? "Blackjack!" : h.status === "bust" ? "Bust" : "Stood"}</span></div>
        <Cards cards={h.cards} />
      </section>)}
      {!hand && round.phase === "playing" && <p className="hand">This hand is underway. You'll join the next deal.</p>}
    </> : <p className="hand">Play against the dealer, or invite your partner to join the other spot.</p>}
    <div className="table-buttons">
      {!round || round.phase === "finished" ? <button className="btn primary" disabled={!ready} onClick={() => send("deal")}>{round ? "Deal again" : "Deal cards"}</button>
        : hand?.status === "playing" && <><button className="btn primary" disabled={!arrived} onClick={() => send("hit")}>Hit</button><button className="btn" disabled={!arrived} onClick={() => send("stand")}>Stand</button></>}
      <button className="btn" onClick={() => act({ do: "stop" })}>Leave table</button>
    </div>
    <p className="hint hand">Aces count as 1 or 11. Dealer draws at reveal and stands on 17.</p>
  </div>;
}
