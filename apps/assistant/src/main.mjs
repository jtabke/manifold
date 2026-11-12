import { parseArgs } from "node:util";
import { createPiFactory } from "./pi.mjs";
import { startCompanion } from "./server.mjs";
import { startManagedCompanion } from "./managed.mjs";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    port: { type: "string", default: "58313" },
    origin: { type: "string", multiple: true },
    help: { type: "boolean" },
    managed: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: npm run assistant -- --provider PROVIDER --model MODEL [--port 58313] [--origin http://127.0.0.1:58310]\nUses existing Pi credentials. Copy the printed connection URL into the canvas assistant. No model requests run until you send a message.",
  );
} else {
  try {
    if (!values.managed && (!values.provider || !values.model))
      throw Error("Specify --provider and --model; use --help for usage");
    const port = Number(values.port);
    if (
      !Number.isInteger(port) ||
      (!values.managed && port < 1024) ||
      port < 0 ||
      port > 65535
    )
      throw Error("Port must be an integer from 1024 to 65535");
    for (const origin of values.origin ?? []) {
      const url = new URL(origin);
      if (
        url.origin !== origin ||
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname)
      )
        throw Error("Origins must be exact local HTTP origins");
    }
    const companion = values.managed
      ? await startManagedCompanion({ port, origins: values.origin })
      : await startCompanion({
          port,
          origins: values.origin,
          createSession: await createPiFactory(values.provider, values.model),
        });
    if (values.managed) console.log(JSON.stringify({ url: companion.url }));
    else
      console.log(
        `Manifold assistant · ${values.provider}/${values.model}\nConnection URL (private; valid until this process stops):\n${companion.url}\nOnly canvas inspection and edit proposals are enabled. Conversations stay in memory.`,
      );
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      await companion.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
