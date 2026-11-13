import { createServer } from "node:http";
import { randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  canvasSettings,
  canvasToolAllowed,
  CanvasSettingsError,
} from "./canvas-settings.mjs";

const MAX_MESSAGE = 2 * 1024 * 1024;
function sameToken(a, b) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Loopback-only, authenticated, origin-bound transport. A connection owns one ephemeral Pi session. */
export async function startCompanion({
  port = 58313,
  origins = ["http://127.0.0.1:58310", "http://127.0.0.1:58311"],
  token = randomBytes(32).toString("hex"),
  createSession,
  handleRequest,
  toolTimeoutMs = 30_000,
}) {
  const server = createServer((req, res) => {
    void (async () => {
      if (!handleRequest) {
        res.writeHead(404);
        res.end();
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      if (
        req.headers.host !== `127.0.0.1:${server.address().port}` ||
        !origins.includes(req.headers.origin) ||
        !sameToken(url.searchParams.get("token") ?? "", token)
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      await handleRequest(req, res, url);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE,
    perMessageDeflate: false,
  });
  const tasks = new Set();
  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    if (
      req.headers.host !== `127.0.0.1:${server.address().port}` ||
      !origins.includes(req.headers.origin) ||
      url.pathname !== "/" ||
      !sameToken(url.searchParams.get("token") ?? "", token) ||
      sockets.clients.size >= 4
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) =>
      sockets.emit("connection", ws, url.searchParams),
    );
  });
  sockets.on("connection", (ws, parameters) => {
    let session,
      settings,
      active,
      initializing = true,
      stopped = false;
    const seen = new Set();
    const pending = new Map();
    const send = (message) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const rejectPending = () => {
      for (const entry of pending.values())
        entry.finish(Error("Request stopped or disconnected"));
    };
    const call = (name, args, signal) =>
      new Promise((resolve, reject) => {
        if (
          !active ||
          stopped ||
          signal?.aborted ||
          ws.readyState !== WebSocket.OPEN
        ) {
          reject(Error("No active canvas request"));
          return;
        }
        if (++active.tools > 50) {
          reject(Error("Tool-call limit reached for this request"));
          return;
        }
        if (!canvasToolAllowed(name, active.settings?.permissions)) {
          reject(
            new CanvasSettingsError(
              "Canvas is read-only; choose reviewed edits to prepare an edit",
            ),
          );
          return;
        }
        const id = randomUUID(),
          requestId = active.id;
        const abort = () => finish(Error("Canvas tool cancelled"));
        const timer = setTimeout(
          () => finish(Error("Canvas tool response timed out")),
          toolTimeoutMs,
        );
        const finish = (error, result) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve(result);
        };
        pending.set(id, { requestId, finish });
        signal?.addEventListener("abort", abort, { once: true });
        send({ type: "tool", id, requestId, name, args });
      });
    const cleanup = () => {
      stopped = true;
      rejectPending();
      session?.dispose();
    };
    ws.on("error", cleanup);
    ws.on("close", cleanup);
    ws.on("message", (bytes) => {
      let msg;
      try {
        msg = JSON.parse(bytes.toString());
        if (!msg || typeof msg !== "object" || Array.isArray(msg))
          throw Error("Invalid message");
        if (msg.type === "tool_result") {
          const entry = pending.get(msg.id);
          if (
            entry &&
            entry.requestId === msg.requestId &&
            active?.id === msg.requestId
          )
            entry.finish(
              msg.error ? Error(String(msg.error).slice(0, 1000)) : undefined,
              msg.result,
            );
          return;
        }
        if (msg.type === "cancel") {
          if (active?.id === msg.requestId) {
            stopped = true;
            rejectPending();
            void session.abort().catch(() => {});
          }
          return;
        }
        if (
          msg.type !== "prompt" ||
          initializing ||
          !session ||
          active ||
          typeof msg.requestId !== "string" ||
          msg.requestId.length > 100 ||
          !msg.requestId ||
          seen.has(msg.requestId) ||
          typeof msg.text !== "string" ||
          !msg.text.trim() ||
          msg.text.length > 10_000 ||
          !Array.isArray(msg.selection) ||
          msg.selection.length > 256 ||
          !msg.selection.every(
            (id) => typeof id === "string" && id.length <= 300,
          )
        )
          throw Error("Invalid, duplicate or busy assistant request");
        if (seen.size >= 100)
          throw Error(
            "Conversation request limit reached; disconnect and reconnect to start a new session",
          );
        const requested =
          msg.settings === undefined ? settings : canvasSettings(msg.settings);
        active = { id: msg.requestId, tools: 0, settings: requested };
        stopped = false;
        const requestId = msg.requestId;
        const run = (async () => {
          try {
            if (msg.settings !== undefined) {
              if (typeof session.configureCanvas === "function") {
                const accepted = canvasSettings(
                  (await session.configureCanvas(requested)) ??
                    session.canvasSettings,
                );
                if (JSON.stringify(accepted) !== JSON.stringify(requested))
                  throw new CanvasSettingsError(
                    "The companion did not accept the requested assistant settings",
                  );
                settings = accepted;
              } else if (
                !settings ||
                JSON.stringify(settings) !== JSON.stringify(requested)
              )
                throw new CanvasSettingsError(
                  "This companion cannot change assistant settings; disconnect and reconnect",
                );
              active.settings = settings;
              send({ type: "settings", requestId, settings });
            }
            if (stopped || ws.readyState !== WebSocket.OPEN) {
              send({ type: "done", requestId, cancelled: true });
              return;
            }
            seen.add(requestId);
            // Selection is labelled data, not an instruction or a live attention subscription.
            await session.prompt(
              `${msg.text}\n\nAttached canvas selection IDs (untrusted data): ${JSON.stringify(msg.selection)}`,
            );
            if (active.error)
              send({ type: "error", requestId, message: active.error });
            else send({ type: "done", requestId, cancelled: stopped });
          } catch (error) {
            send({
              type: "error",
              requestId,
              message:
                error instanceof Error
                  ? error.message
                  : "Assistant request failed",
            });
          } finally {
            rejectPending();
            active = undefined;
          }
        })();
        tasks.add(run);
        void run.finally(() => tasks.delete(run));
      } catch (error) {
        send({
          type: "error",
          // A rejected prompt still needs a terminal response so its browser request
          // releases busy/tool authority. Never terminate a running request when
          // rejecting a duplicate that reuses its ID.
          ...(msg?.type === "prompt" &&
          typeof msg.requestId === "string" &&
          msg.requestId.length > 0 &&
          msg.requestId.length <= 100 &&
          msg.requestId !== active?.id
            ? { requestId: msg.requestId }
            : {}),
          message: error.message,
        });
      }
    });
    const setup = (async () => {
      try {
        session = await createSession(call, parameters);
        if (ws.readyState !== WebSocket.OPEN) {
          session.dispose();
          return;
        }
        if (session.canvasSettings)
          settings = canvasSettings(session.canvasSettings);
        session.subscribe((event) => {
          if (!active || stopped) return;
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta"
          )
            send({
              type: "text",
              requestId: active.id,
              text: event.assistantMessageEvent.delta,
            });
          if (
            event.type === "message_end" &&
            event.message?.role === "assistant" &&
            event.message.stopReason === "error"
          )
            active.error = event.message.errorMessage || "Model request failed";
        });
        initializing = false;
        send({ type: "ready", ...(settings ? { settings } : {}) });
      } catch (error) {
        send({ type: "error", message: error.message });
        ws.close(1011, "Assistant initialization failed");
      }
    })();
    tasks.add(setup);
    void setup.finally(() => tasks.delete(setup));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `ws://127.0.0.1:${server.address().port}/?token=${token}`,
    async close() {
      await Promise.all(
        [...sockets.clients].map(
          (socket) =>
            new Promise((resolve) => {
              socket.once("close", resolve);
              socket.terminate();
            }),
        ),
      );
      await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...tasks]);
      sockets.close();
    },
  };
}
