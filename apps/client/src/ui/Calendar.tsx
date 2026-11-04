import {
  DAILY_COINS,
  dayNumber,
  localDay,
  MILESTONES,
  nextMilestone,
  streakStats,
  type Visit,
} from "@cg/shared";
import { useEffect, useId, useRef, useState } from "react";
import { getVisits } from "../net/api";
import { closeWelcomeBack, useGame } from "../state/game";
import { Icon } from "./icons";
import "./calendar.css";

/**
 * Coming back each day: a clock with the house's coins and a calendar button in the top bar, the calendar itself
 * (the month, today, the days you came by, your streaks and what's to come), and a note when a new day is counted.
 * Dates are your own device's, nothing to do with the sun in the game.
 */

const coins = (n: number) => Math.round(n).toLocaleString();

/** The time and date where you are, ticking over by the minute. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** The house's coins, how they're spent (shown on everything for sale), as a little pill. */
export function Coins({ className = "" }: { className?: string }) {
  const funds = useGame((s) => s.view?.funds);
  if (funds === undefined) return null;
  return (
    <span className={`coins ${funds < 0 ? "short" : ""} ${className}`} title="The house's coins">
      <Icon.coin />
      {coins(funds)}
    </span>
  );
}

/** The top bar's clock: the house's coins, the time and date, and the calendar. */
export function ClockPill() {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <>
      <div className="pill clock-pill">
        <Coins />
        <span className="clock-sep" aria-hidden />
        <time className="clock-time" dateTime={now.toISOString()}>
          <span className="clock-hm">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <span className="clock-date">{now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span>
        </time>
        <button
          ref={button}
          className="clock-cal"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls={id}
          aria-label="Daily calendar and streak"
          title="Daily calendar and streak"
        >
          <Icon.calendar />
        </button>
      </div>
      {open && <CalendarCard id={id} onClose={close} />}
    </>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The days of a month laid out Monday first, with blanks before the 1st. */
function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const out: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) out.push(localDay(new Date(year, month, d)));
  return out;
}

function CalendarCard({ id, onClose }: { id: string; onClose: () => void }) {
  const seen = useGame((s) => s.visitsSeen);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const today = localDay();
  const now = new Date();
  const [shown, setShown] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const card = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    let live = true;
    getVisits()
      .then((r) => live && (setVisits(r.visits), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [seen]);

  useEffect(() => {
    card.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  const byDay = new Map((visits ?? []).map((v) => [v.day, v]));
  const days = [...byDay.keys()];
  const stats = streakStats(days, today);
  const next = nextMilestone(stats.current);
  const countedToday = byDay.has(today);

  // back as far as the first month you came by; never past this one
  const first = visits?.[0] ? new Date(`${visits[0].day}T00:00`) : now;
  const atStart = shown.year < first.getFullYear() || (shown.year === first.getFullYear() && shown.month <= first.getMonth());
  const atNow = shown.year > now.getFullYear() || (shown.year === now.getFullYear() && shown.month >= now.getMonth());
  const step = (by: number) => {
    const d = new Date(shown.year, shown.month + by, 1);
    setShown({ year: d.getFullYear(), month: d.getMonth() });
  };
  const label = new Date(shown.year, shown.month, 1).toLocaleDateString([], { month: "long", year: "numeric" });

  return (
    <div ref={card} id={id} className="card popover calendar-card" role="dialog" aria-labelledby={titleId} tabIndex={-1}>
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kicker" id={titleId}>
        Your days here
      </div>

      <div className="cal-stats">
        <Stat value={stats.current} label="day streak" big />
        <Stat value={stats.longest} label="longest" />
        <Stat value={stats.total} label={stats.total === 1 ? "day visited" : "days visited"} />
      </div>

      <p className="cal-today hand" role="status">
        {failed
          ? "Couldn't load your calendar just now."
          : countedToday
            ? `Today's counted: +${coins(byDay.get(today)!.coins)} coins for the house.`
            : `Do anything in the house today to collect +${DAILY_COINS} coins.`}
      </p>

      <div className="cal-head">
        <button className="cal-step" onClick={() => step(-1)} disabled={atStart} aria-label="Previous month">
          <Icon.chevronLeft />
        </button>
        <div className="cal-month" aria-live="polite">
          {label}
        </div>
        <button className="cal-step" onClick={() => step(1)} disabled={atNow} aria-label="Next month">
          <Icon.chevronRight />
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label={label}>
        <div className="cal-row" role="row">
          {WEEKDAYS.map((w) => (
            <span key={w} className="cal-wd" role="columnheader" aria-label={w}>
              {w.slice(0, 2)}
            </span>
          ))}
        </div>
        {chunk(monthGrid(shown.year, shown.month), 7).map((week, i) => (
          <div key={i} className="cal-row" role="row">
            {week.map((day, j) => {
              if (!day) return <span key={j} className="cal-day blank" role="gridcell" aria-hidden />;
              const v = byDay.get(day);
              const isToday = day === today;
              const future = dayNumber(day)! > dayNumber(today)!;
              const bonus = v && MILESTONES.some((m) => m.days === v.streak);
              const date = new Date(`${day}T00:00`);
              const spoken = `${date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}${isToday ? ", today" : ""}${v ? `, visited, ${v.coins} coins${bonus ? `, ${v.streak}-day bonus` : ""}` : ""}`;
              return (
                <span
                  key={j}
                  role="gridcell"
                  aria-label={spoken}
                  aria-current={isToday ? "date" : undefined}
                  className={`cal-day ${v ? "visited" : ""} ${isToday ? "today" : ""} ${future ? "future" : ""} ${bonus ? "bonus" : ""}`}
                  title={v ? `+${coins(v.coins)} coins${bonus ? ` · ${v.streak}-day bonus` : ""}` : undefined}
                >
                  <span className="cal-num">{date.getDate()}</span>
                  {v && <span className="cal-mark" aria-hidden>{bonus ? "★" : "✓"}</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className="kicker cal-rewards-title">Rewards</div>
      <ul className="cal-rewards">
        <li className="earned-daily">
          <span className="reward-what">Every day you drop by</span>
          <span className="reward-coins">
            <Icon.coin />+{DAILY_COINS}
          </span>
        </li>
        {MILESTONES.map((m) => {
          const earned = stats.current >= m.days;
          const upcoming = next?.days === m.days;
          return (
            <li key={m.days} className={earned ? "earned" : upcoming ? "next" : ""}>
              <span className="reward-what">
                {m.days} days in a row
                <span className="reward-state">
                  {earned ? " · earned ✓" : upcoming ? ` · ${next.left} more ${next.left === 1 ? "day" : "days"}` : ""}
                </span>
              </span>
              <span className="reward-coins">
                <Icon.coin />+{coins(m.coins)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint hand">Coins go to the house you're in, and pay for furniture, doors and windows. Selling something gives its coins back.</p>
    </div>
  );
}

function Stat({ value, label, big = false }: { value: number; label: string; big?: boolean }) {
  return (
    <div className={`cal-stat ${big ? "big" : ""}`}>
      <span className="cal-stat-n">{value}</span>
      <span className="cal-stat-l">{label}</span>
    </div>
  );
}

function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** A small note when a new day is counted: welcoming whatever the streak, never about days missed. */
export function WelcomeBack() {
  const visit = useGame((s) => s.welcomeBack);
  useEffect(() => {
    if (!visit) return;
    const t = window.setTimeout(closeWelcomeBack, 15_000);
    return () => window.clearTimeout(t);
  }, [visit]);
  if (!visit) return null;
  const bonus = visit.milestone ? MILESTONES.find((m) => m.days === visit.milestone)?.coins : undefined;
  return (
    <div className="card welcome-back" role="status">
      <button className="close" onClick={closeWelcomeBack} aria-label="Dismiss">
        ×
      </button>
      <div className="welcome-coin" aria-hidden>
        <Icon.coin />
      </div>
      <div>
        <div className="welcome-title">{visit.streak > 1 ? `Day ${visit.streak} in a row!` : "Welcome home!"}</div>
        <p className="hand">
          {visit.streak > 1 ? "Lovely to see you again. " : "So glad you're here. "}+{DAILY_COINS} coins for the house
          {bonus ? `, plus a ${visit.milestone}-day bonus of +${coins(bonus)}` : ""}.
        </p>
      </div>
    </div>
  );
}
