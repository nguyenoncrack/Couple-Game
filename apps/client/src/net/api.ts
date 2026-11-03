export interface JoinedHouse {
  houseId: string;
  houseName: string;
  memberId: string;
  token: string;
  inviteCode: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("offline", "Can't reach the game server. Is it running?");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(data.error ?? "server", data.message ?? "Something went wrong.");
  return data as T;
}

export const createHouse = (houseName: string, playerName: string, starter = false) => post<JoinedHouse>("/api/houses", { houseName, playerName, starter });
export const joinHouse = (code: string, playerName: string) => post<JoinedHouse>("/api/join", { code, playerName });
