import { useEffect, useState } from "react";
import { savedHouse } from "./net/session";
import { Game } from "./screens/Game";
import { Home } from "./screens/Home";

/** Three routes: home (/), an invite link (/join/CODE) and a house (/h/ID). */
type Route = { page: "home"; code?: string; notice?: string } | { page: "house"; houseId: string };

function parse(path: string): Route {
  const join = /^\/join\/([A-Za-z0-9-]{6,9})\/?$/.exec(path);
  if (join) return { page: "home", code: join[1]!.toUpperCase() };
  const house = /^\/h\/([A-Za-z0-9_-]{6,40})\/?$/.exec(path);
  if (house) return { page: "house", houseId: house[1]! };
  return { page: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname));

  useEffect(() => {
    const pop = () => setRoute(parse(location.pathname));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const go = (path: string, next: Route) => {
    history.pushState(null, "", path);
    setRoute(next);
  };

  if (route.page === "house") {
    const house = savedHouse(route.houseId);
    if (!house) return <Home notice="This browser hasn't joined that house. Ask for the room code." onOpen={(id) => go(`/h/${id}`, { page: "house", houseId: id })} />;
    return <Game house={house} onLeave={() => go("/", { page: "home" })} />;
  }
  return <Home key={route.code ?? ""} initialCode={route.code} notice={route.notice} onOpen={(id) => go(`/h/${id}`, { page: "house", houseId: id })} />;
}
