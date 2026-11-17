/** Workers Assets delivers whole files. Serve byte ranges so the browser can seek within the live set. */
export async function serveAudioRange(req: Request, assets: Fetcher): Promise<Response> {
  const range = /^bytes=(\d*)-(\d*)$/i.exec(req.headers.get("range") ?? "");
  if (req.method !== "GET" || !range || (!range[1] && !range[2])) return assets.fetch(req);

  const asset = await assets.fetch(new Request(req.url, { headers: { "accept-encoding": "identity" } }));
  if (asset.status !== 200 || !asset.body || asset.headers.get("content-type")?.split(";")[0] !== "audio/mpeg") return asset;

  const ifRange = req.headers.get("if-range");
  if (ifRange && ifRange !== asset.headers.get("etag") && ifRange !== asset.headers.get("last-modified")) return asset;

  const declaredSize = Number(asset.headers.get("content-length"));
  const buffer = Number.isSafeInteger(declaredSize) && declaredSize > 0 ? undefined : await asset.arrayBuffer();
  const size = buffer?.byteLength ?? declaredSize;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || end < start) {
    if (!buffer) await asset.body.cancel();
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }

  const length = end - start + 1;
  const headers = new Headers(asset.headers);
  headers.delete("content-encoding");
  headers.set("accept-ranges", "bytes");
  headers.set("content-length", String(length));
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  if (buffer) return new Response(new Uint8Array(buffer, start, length), { status: 206, headers });

  // Forward just this slice of the asset without buffering the entire set in the Worker.
  const limited = new FixedLengthStream(length);
  let at = 0;
  const slice = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const from = Math.max(0, start - at);
      const until = Math.min(chunk.length, end + 1 - at);
      if (from < until) controller.enqueue(chunk.subarray(from, until));
      at += chunk.length;
      if (at > end) controller.terminate();
    },
  });
  void asset.body.pipeThrough(slice).pipeTo(limited.writable).catch(() => {
    // A browser may cancel a range request when it seeks or switches records.
  });
  return new Response(limited.readable, { status: 206, headers });
}
