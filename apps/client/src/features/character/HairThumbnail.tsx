import type { Hairstyle } from "./appearance";
const FRONT: Record<Hairstyle, string> = {
  buzz: "M16 30C14 11 47 10 48 30L45 25Q32 17 19 26Z",
  "side-part": "M15 31C10 10 47 7 49 29L42 32 40 22Q31 28 16 32Z",
  quiff: "M16 31Q9 21 20 15Q18 5 29 10Q42 5 47 15L49 30 43 26 41 21Q29 26 16 31Z",
  curls: "M14 32Q7 24 13 20Q9 12 18 13Q18 5 25 10Q33 2 37 10Q46 6 47 16Q56 19 48 31L42 25 21 25Z",
  curtains: "M14 34C10 9 53 9 50 34L43 38 37 25 32 21 26 27 21 37Z",
  "top-knot": "M15 31C11 12 49 11 49 31L43 25Q31 19 20 26Z M25 13C16-1 44-2 39 13Z",
  bob: "M13 45V27C12 6 53 8 51 30V45L43 44 42 26Q29 31 21 26L21 46Z",
  long: "M12 52V28C10 6 54 8 52 28L53 53 43 51 41 27 33 20 24 28 22 52Z",
  ponytail: "M14 31C11 10 50 8 49 31L43 28 39 23Q28 29 19 27Z",
  braid: "M14 31C11 9 50 8 49 31L43 28 39 23Q28 29 19 27Z",
  "space-buns": "M15 30C11 9 50 9 49 30L43 26 22 26Z M11 23C0 7 24 4 22 19Z M44 20C41 3 64 8 53 25Z",
  waves: "M13 52Q6 46 13 39Q6 30 13 25C10 5 54 8 52 27Q59 34 52 40Q59 48 51 53L42 50 42 28 33 20 24 27 22 51Z",
};
export function HairThumbnail({ style, hair, skin }: { style: Hairstyle; hair: string; skin: string }) {
  return <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    {style === "ponytail" && <path d="M45 23Q62 15 54 47L44 52 43 35Z" fill={hair} stroke="#4a4037" strokeWidth="1.3" />}
    {style === "braid" && <path d="M45 27q16 1 6 8 10 6-1 10 9 5-1 10l-5-3q-7-4 0-9-6-7 0-10Z" fill={hair} stroke="#4a4037" strokeWidth="1.3" />}
    <path d="M15 64q0-16 17-17 17 1 17 17" fill="#c5d0b3" stroke="#4a4037" strokeWidth="1.3" />
    <path d="M28 46v8h8v-8" fill={skin} stroke="#4a4037" strokeWidth="1.3" />
    <ellipse cx="32" cy="33" rx="16" ry="19" fill={skin} stroke="#4a4037" strokeWidth="1.3" />
    <path d={FRONT[style]} fill={hair} stroke="#4a4037" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="m26 35 0 1m12-1 0 1m-9 7q3 2 6 0" stroke="#4a4037" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
