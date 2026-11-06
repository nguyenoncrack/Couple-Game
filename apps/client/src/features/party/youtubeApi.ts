/**
 * YouTube's official IFrame Player API (https://developers.google.com/youtube/iframe_api_reference): the script is
 * loaded from YouTube once, and videos are played by its own embedded player. Nothing here touches the media.
 */

export interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoLoadedFraction(): number;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}

/** The player's states (`onStateChange`'s `data`). */
export const YT_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

/** `onError` codes worth telling someone about. */
export const YT_ERROR_TEXT: Record<number, string> = {
  2: "That link doesn't look like a playable video.",
  5: "YouTube couldn't play that video here.",
  100: "That video has been removed or is private.",
  101: "The video's owner doesn't allow it to play in other sites.",
  150: "The video's owner doesn't allow it to play in other sites.",
};

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width: number | string;
      height: number | string;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
        onAutoplayBlocked?: () => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

/** Load the API (once). Rejects if YouTube can't be reached, so the panel can say so. */
export function loadYouTubeApi(timeoutMs = 15_000): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => {
      loading = null;
      reject(new Error("YouTube didn't load"));
    }, timeoutMs);
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      loading = null;
      script.remove();
      reject(new Error("YouTube couldn't be reached"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
