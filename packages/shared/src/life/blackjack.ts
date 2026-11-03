/** Cards are 0–51 (four suits, Ace through King). Future cards are drawn on the server, never sent as a deck. */
export interface BlackjackHand {
  cards: number[];
  seat?: number;
  status: "playing" | "stood" | "bust" | "blackjack" | "left";
  result?: "win" | "lose" | "push";
}
export interface BlackjackRound {
  id: string;
  phase: "playing" | "finished";
  dealer: number[];
  hands: Record<string, BlackjackHand>;
}
export type BlackjackCommand = "deal" | "hit" | "stand";

export function cardLabel(card: number) {
  const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card % 13]!;
  const suit = ["♠", "♥", "♣", "♦"][Math.floor(card / 13)]!;
  return { rank, suit, red: Math.floor(card / 13) % 2 === 1 };
}

export function blackjackScore(cards: readonly number[]) {
  let total = 0, aces = 0;
  for (const card of cards) {
    const rank = card % 13 + 1;
    total += rank === 1 ? 11 : Math.min(rank, 10);
    if (rank === 1) aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
export const naturalBlackjack = (cards: readonly number[]) => cards.length === 2 && blackjackScore(cards) === 21;

function draw(round: BlackjackRound, random: () => number) {
  const used = new Set([...round.dealer, ...Object.values(round.hands).flatMap((h) => h.cards)]);
  const available = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  if (!available.length) throw Error("Blackjack deck exhausted");
  return available[Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)))]!;
}

/** One dealer card is visible during play; the second is drawn at reveal, so there is no hidden client state. */
export function dealBlackjack(id: string, players: string[], random = Math.random): BlackjackRound {
  const round: BlackjackRound = { id, phase: "playing", dealer: [], hands: {} };
  players.forEach((player, seat) => { round.hands[player] = { cards: [], status: "playing", seat }; });
  for (let i = 0; i < 2; i++) for (const h of Object.values(round.hands)) h.cards.push(draw(round, random));
  round.dealer.push(draw(round, random));
  for (const h of Object.values(round.hands)) if (naturalBlackjack(h.cards)) h.status = "blackjack";
  finishBlackjack(round, random);
  return round;
}

export function finishBlackjack(round: BlackjackRound, random = Math.random) {
  if (round.phase !== "playing" || Object.values(round.hands).some((h) => h.status === "playing")) return false;
  // Reveal the dealer's hand; stand on every 17, including soft 17.
  while (round.dealer.length < 2 || blackjackScore(round.dealer) < 17) round.dealer.push(draw(round, random));
  const dealer = blackjackScore(round.dealer);
  const natural = naturalBlackjack(round.dealer);
  for (const h of Object.values(round.hands)) {
    const score = blackjackScore(h.cards);
    h.result = h.status === "left" || score > 21 ? "lose"
      : naturalBlackjack(h.cards) ? natural ? "push" : "win"
      : natural ? "lose"
      : dealer > 21 || score > dealer ? "win"
      : score === dealer ? "push" : "lose";
  }
  round.phase = "finished";
  return true;
}

export function playBlackjack(round: BlackjackRound, memberId: string, command: "hit" | "stand", random = Math.random) {
  const hand = round.hands[memberId];
  if (round.phase !== "playing" || hand?.status !== "playing") return false;
  if (command === "stand") hand.status = "stood";
  else {
    hand.cards.push(draw(round, random));
    const score = blackjackScore(hand.cards);
    if (score > 21) hand.status = "bust";
    else if (score === 21) hand.status = "stood";
  }
  finishBlackjack(round, random);
  return true;
}
