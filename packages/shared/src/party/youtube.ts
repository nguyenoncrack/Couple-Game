/**
 * YouTube links. Only the 11-character video ID is kept: the house stores what to play, never any media. The
 * video itself is played by YouTube's own embedded player on each screen.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (s: unknown): s is string => typeof s === "string" && VIDEO_ID.test(s);

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be", "www.youtu.be"]);

/** Where in the video a link starts, in seconds: `t=90`, `t=1m30s`, `start=90`. */
function startOf(url: URL): number | undefined {
  const raw = url.searchParams.get("t") ?? url.searchParams.get("start") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("t");
  if (!raw) return undefined;
  let seconds = 0;
  if (/^\d+$/.test(raw)) seconds = Number(raw);
  else {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
    if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
    seconds = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  return seconds > 0 && seconds <= 43_200 ? Math.floor(seconds) : undefined;
}

export interface ParsedLink {
  videoId: string;
  start?: number;
}

/**
 * The video a pasted link or bare ID points at, or null if it isn't one that can be played (a playlist or channel
 * page, another site, or a malformed ID).
 */
export function parseYouTubeLink(text: string): ParsedLink | null {
  const s = text.trim();
  if (!s || s.length > 300) return null;
  if (isVideoId(s)) return { videoId: s };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (url.hostname.toLowerCase().endsWith("youtu.be")) id = parts[0];
  else if (parts[0] === "watch") id = url.searchParams.get("v") ?? undefined;
  else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
  if (!isVideoId(id)) return null;
  const start = startOf(url);
  return start ? { videoId: id, start } : { videoId: id };
}

/** The link to a video on YouTube itself. */
export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
