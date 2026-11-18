import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { Database } from "../local-d1.ts";
import { authConfig, type AuthEnvironment } from "../private/auth-config.ts";
import { catalogHandler, publicAssets } from "./catalog-handler.ts";

export async function listenCatalog(db: Database, { port = 4173, now = () => new Date(), developmentAuth = false,
  authEnvironment = {} as AuthEnvironment } = {}) {
  await db.prepare("SELECT id FROM editions LIMIT 1").first();
  const development = process.env.NODE_ENV === "development";
  // A production process never turns this Phase 5 boolean into demo auth.
  const env = { ...authEnvironment, AUTH_MODE: authEnvironment.AUTH_MODE ?? (developmentAuth && development ? "demo" : "disabled") };
  if (env.AUTH_MODE !== "disabled") await db.prepare("SELECT id FROM private_entries LIMIT 1").first();
  const files = new Map(await Promise.all([...publicAssets].map(async ([path, type]) =>
    [path, { type, body: new Uint8Array(await readFile(new URL(`../../public${path}`, import.meta.url))) }] as const)));
  let origin = "";
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const part of value) headers.append(key, part);
        else if (value !== undefined) headers.set(key, value);
      }
      const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "127.0.0.1"}`);
      const init: RequestInit & { duplex?: "half" } = { method: incoming.method, headers };
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>; init.duplex = "half";
      }
      const response = await catalogHandler(new Request(url, init), db, {
        auth: authConfig(env, development, origin), now,
        asset: async (request) => {
          const file = files.get(new URL(request.url).pathname)!;
          return new Response(request.method === "HEAD" ? null : file.body, { headers: {
            "Content-Type": file.type, "Cache-Control": "public, max-age=600", "X-Content-Type-Options": "nosniff",
          } });
        },
      });
      outgoing.statusCode = response.status;
      for (const [key, value] of response.headers) if (key !== "set-cookie") outgoing.setHeader(key, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
      outgoing.end(new Uint8Array(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end("Request failed"); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No preview address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    }),
  };
}
