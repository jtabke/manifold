/** Same restricted companion, started and owned by the local canvas server. */
import { randomBytes } from "node:crypto";
import { assistantConfiguration, createPiFactory } from "./pi.mjs";
import { startCompanion } from "./server.mjs";

function reply(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (req.headers["content-type"] !== "application/json")
    throw Error("Expected JSON");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16000) throw Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function startManagedCompanion({
  origins,
  port = 0,
  configuration = assistantConfiguration,
  factory = createPiFactory,
  grantTimeoutMs = 60000,
}) {
  const grants = new Map();
  let configuring = 0;
  let companion;
  companion = await startCompanion({
    port,
    origins,
    createSession: async (call, parameters) => {
      const ticket = parameters.get("ticket");
      const grant = grants.get(ticket);
      if (!grant)
        throw Error("Connection expired. Click Connect again in the canvas.");
      grants.delete(ticket);
      clearTimeout(grant.timer);
      return grant.factory(call);
    },
    handleRequest: async (req, res, url) => {
      try {
        if (url.pathname === "/configuration" && req.method === "GET") {
          reply(res, 200, await configuration());
          return;
        }
        if (url.pathname !== "/connect" || req.method !== "POST") {
          reply(res, 404, { error: "Unknown assistant endpoint" });
          return;
        }
        const input = await body(req);
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).some(
            (key) => !["provider", "model", "apiKey"].includes(key),
          ) ||
          typeof input.provider !== "string" ||
          !input.provider ||
          input.provider.length > 150 ||
          typeof input.model !== "string" ||
          !input.model ||
          input.model.length > 300 ||
          (input.apiKey !== undefined &&
            (typeof input.apiKey !== "string" || input.apiKey.length > 8000))
        )
          throw Error(
            "Choose a provider and model, and optionally supply an API key",
          );
        if (grants.size + configuring >= 4)
          throw Error("Too many pending connections. Wait a minute and retry.");
        // A separate runtime per connection keeps a supplied key scoped to this conversation.
        // The factory stores it in memory only, never in Pi's credential file or a native archive.
        // Reserve capacity before async setup so simultaneous tabs cannot all
        // pass the pending-connection limit while their runtimes are loading.
        configuring++;
        let createSession;
        try {
          createSession = await factory(
            input.provider,
            input.model,
            input.apiKey || undefined,
          );
        } finally {
          configuring--;
        }
        const ticket = randomBytes(32).toString("hex");
        const timer = setTimeout(() => grants.delete(ticket), grantTimeoutMs);
        timer.unref();
        grants.set(ticket, { factory: createSession, timer });
        const endpoint = new URL(companion.url);
        endpoint.searchParams.set("ticket", ticket);
        reply(res, 200, { url: endpoint.href });
      } catch (error) {
        // SDK/provider errors can contain credential material. Only return actionable local errors.
        reply(res, 400, {
          error:
            url.pathname === "/configuration"
              ? "Could not read Pi configuration. Check your local Pi setup and retry."
              : "Could not configure the assistant. Check the provider/model and API key, then retry.",
        });
      }
    },
  });
  return {
    url: companion.url,
    async close() {
      for (const grant of grants.values()) clearTimeout(grant.timer);
      grants.clear();
      await companion.close();
    },
  };
}
