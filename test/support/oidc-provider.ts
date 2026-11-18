// Test fixture only. Never imported by the deployed Worker or the real Google preview.
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

export type Fault = "none" | "nonce" | "issuer" | "audience" | "expired" | "signature" | "denied";
export function signedTestProvider(issuer: string, endpoints = {
  authorization: issuer + "/authorize", token: issuer + "/token", jwks: issuer + "/jwks",
}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const grants = new Map<string, { nonce: string; challenge: string; redirect: string; subject: string; fault: Fault }>();
  let fault: Fault = "none", email = "shared-address@example.test";
  const counters = { token: 0, jwks: 0 };
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  return {
    counters,
    setFault(value: Fault) { fault = value; }, setEmail(value: string) { email = value; },
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration") return json({
        issuer, authorization_endpoint: endpoints.authorization, token_endpoint: endpoints.token, jwks_uri: endpoints.jwks,
        response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"], code_challenge_methods_supported: ["S256"],
      });
      if (url.href.split("?")[0] === endpoints.jwks) {
        counters.jwks++;
        return json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" }] });
      }
      if (url.href.split("?")[0] === endpoints.authorization) {
        if (url.searchParams.get("identity")) {
          const callback = new URL(url.searchParams.get("redirect_uri")!);
          callback.searchParams.set("state", url.searchParams.get("state")!);
          if (fault === "denied") callback.searchParams.set("error", "access_denied");
          else {
            const code = randomUUID();
            grants.set(code, { nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")!,
              redirect: url.searchParams.get("redirect_uri")!, subject: "test-provider-" + url.searchParams.get("identity"), fault });
            callback.searchParams.set("code", code);
          }
          return new Response(null, { status: 303, headers: { Location: callback.href } });
        }
        const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
        return new Response(`<!doctype html><html lang="en"><title>Local test identity provider</title><h1>Test provider — no real Google account</h1>
          <form method="get" action="${escape(url.pathname)}">${[...url.searchParams].map(([k,v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`).join("")}
          <label>Test account<select name="identity" aria-label="Test account"><option value="one">Test account One</option><option value="two">Test account Two</option></select></label>
          <button>Approve test sign-in</button></form></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (url.href === endpoints.token && request.method === "POST") {
        counters.token++;
        const data = new URLSearchParams(await request.text()), code = data.get("code") ?? "";
        const grant = grants.get(code); grants.delete(code);
        const challenge = createHash("sha256").update(data.get("code_verifier") ?? "").digest("base64url");
        if (!grant || data.get("client_id") !== "test-client" || data.get("client_secret") !== "test-secret"
          || data.get("redirect_uri") !== grant.redirect || challenge !== grant.challenge) return json({ error: "invalid_grant" }, 400);
        const now = Math.floor(Date.now() / 1000), f = grant.fault;
        const encoded = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
        const message = encoded({ alg: "RS256", kid: "test-key" }) + "." + encoded({
          iss: f === "issuer" ? "https://wrong.example.test" : issuer,
          sub: grant.subject, aud: f === "audience" ? "wrong-client" : "test-client", iat: now,
          exp: f === "expired" ? now - 3600 : now + 300, nonce: f === "nonce" ? "wrong-nonce" : grant.nonce,
          name: grant.subject === "test-provider-one" ? "Provider One" : "Provider Two", email, email_verified: true,
        });
        return json({ access_token: "test-access-token", token_type: "Bearer", expires_in: 300,
          id_token: message + "." + sign("RSA-SHA256", Buffer.from(message), f === "signature" ? wrongKey : privateKey).toString("base64url") });
      }
      return new Response("Not found", { status: 404 });
    },
  };
}

export async function startTestProvider(port = 0, hostname: "127.0.0.1" | "localhost" = "127.0.0.1") {
  if (process.env.NODE_ENV === "production") throw new Error("Test provider is disabled in production");
  let provider: ReturnType<typeof signedTestProvider>;
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const method = incoming.method ?? "GET";
    const response = await provider.handle(new Request(new URL(incoming.url ?? "/", providerIssuer), {
      method, headers: { "content-type": incoming.headers["content-type"] ?? "" },
      ...(method === "POST" ? { body: Buffer.concat(chunks) } : {}),
    }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(new Uint8Array(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen({ host: "127.0.0.1", port }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test provider address");
  const providerIssuer = `http://${hostname}:${address.port}`;
  provider = signedTestProvider(providerIssuer);
  return { ...provider, issuer: providerIssuer,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    }) };
}
