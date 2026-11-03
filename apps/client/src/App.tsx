import type { HouseSummary, Me } from "@cg/shared";
import { useEffect, useState } from "react";
import { ApiError, claimHouses, getMe, joinHouse } from "./net/api";
import { deviceClaims, forgetDeviceClaims } from "./net/session";
import { Game } from "./screens/Game";
import { Home } from "./screens/Home";
import { SignIn } from "./screens/SignIn";

/** Three routes: home (/), an invite link (/join/CODE) and a house (/h/ID). */
type Route = { page: "home"; code?: string } | { page: "house"; houseId: string };

function parse(path: string): Route {
  const join = /^\/join\/([A-Za-z0-9-]{6,9})\/?$/.exec(path);
  if (join) return { page: "home", code: join[1]!.toUpperCase() };
  const house = /^\/h\/([A-Za-z0-9_-]{6,40})\/?$/.exec(path);
  if (house) return { page: "house", houseId: house[1]! };
  return { page: "home" };
}

/** Who's signed in: still asking, nobody, couldn't reach the server, or an account and its houses. */
type Who = { kind: "loading" } | { kind: "out" } | { kind: "offline"; message: string } | { kind: "in"; me: Me };

/** Ask who's signed in, moving any houses this browser joined before accounts onto the account. */
async function whoAmI(): Promise<Who> {
  try {
    const claims = deviceClaims();
    const me = claims.length ? await claimHouses(claims) : await getMe();
    forgetDeviceClaims();
    return { kind: "in", me };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { kind: "out" };
    return { kind: "offline", message: e instanceof ApiError ? e.message : "Something went wrong." };
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname));
  const [who, setWho] = useState<Who>({ kind: "loading" });

  useEffect(() => {
    const pop = () => setRoute(parse(location.pathname));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  // A fresh house list on every page change (a partner may have joined, or left).
  useEffect(() => {
    void whoAmI().then(setWho);
  }, [route.page]);

  const go = (path: string, next: Route) => {
    history.pushState(null, "", path);
    setRoute(next);
  };
  const home = () => go("/", { page: "home" });
  const open = (houseId: string) => go(`/h/${houseId}`, { page: "house", houseId });

  if (who.kind === "loading") return <div className="home loading-home hand">Finding your keys…</div>;
  if (who.kind === "offline")
    return (
      <div className="home">
        <div className="card notice hand">{who.message}</div>
        <button className="btn" onClick={() => void whoAmI().then(setWho)}>
          Try again
        </button>
      </div>
    );
  if (who.kind === "out") {
    const code = route.page === "home" ? route.code : undefined;
    const signedIn = async (me: Me) => {
      // came from an invite link: go straight in (if that fails, home shows the code to try again and why)
      if (code) {
        try {
          const h = await joinHouse(code);
          setWho({ kind: "in", me: { ...me, houses: [h, ...me.houses.filter((x) => x.houseId !== h.houseId)] } });
          open(h.houseId);
          return;
        } catch {
          // fall through
        }
      }
      setWho({ kind: "in", me });
    };
    return <SignIn inviteCode={code} onSignedIn={(me) => void signedIn(me)} />;
  }

  const me = who.me;
  const setMe = (next: Me) => setWho({ kind: "in", me: next });

  if (route.page === "house") {
    const house = me.houses.find((h) => h.houseId === route.houseId);
    if (house) return <Game house={house} onLeave={home} />;
    // maybe made or joined in another tab since we last asked
    return <Home key="missing" me={me} setMe={setMe} notice="You're not in that house. Ask your partner for the room code." onOpen={open} onSignedOut={() => setWho({ kind: "out" })} />;
  }
  const added = (h: HouseSummary) => {
    setMe({ ...me, houses: [h, ...me.houses.filter((x) => x.houseId !== h.houseId)] });
    open(h.houseId);
  };
  return <Home key={route.code ?? ""} me={me} setMe={setMe} initialCode={route.code} onOpen={open} onAdded={added} onSignedOut={() => setWho({ kind: "out" })} />;
}
