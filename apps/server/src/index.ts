import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { openSqlite } from "./persistence/node-sqlite";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL("../../../data/game.sqlite", import.meta.url));
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));

const db = openSqlite(dbPath);
const app = createApp({
  directory: db.directory,
  houses: db.houses,
  staticDir: process.env.NODE_ENV === "production" && existsSync(clientDist) ? clientDist : undefined,
  // a shorter quiet spell, to try out the "house is napping" screen
  houseIdleMs: process.env.HOUSE_IDLE_MS ? Number(process.env.HOUSE_IDLE_MS) : undefined,
});

app.http.listen(port, () => console.log(`[server] listening on http://localhost:${port} (db: ${dbPath})`));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log("[server] saving houses and shutting down…");
  await app.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
