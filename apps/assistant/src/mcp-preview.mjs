import { App } from "@modelcontextprotocol/ext-apps";

const status = document.querySelector("#status");
const image = document.querySelector("#preview");
const app = new App(
  { name: "Manifold canvas preview", version: "0.1.0" },
  {},
  { autoResize: true },
);
app.ontoolresult = (result) => {
  image.removeAttribute("src");
  image.hidden = true;
  const content = result.content?.find(
    (item) => item.type === "image" && item.mimeType === "image/jpeg",
  );
  if (
    result.isError ||
    !content ||
    typeof content.data !== "string" ||
    content.data.length > 1_500_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content.data)
  ) {
    status.textContent =
      "No canvas image available. Reconnect or request a new look_at_canvas.";
    return;
  }
  image.src = "data:image/jpeg;base64," + content.data;
  image.hidden = false;
  status.textContent =
    "Captured canvas image — not a live view or engineering validation. Request look_at_canvas again to refresh.";
};
app.ontoolcancelled = () => {
  status.textContent =
    "Capture cancelled. The previous image, if shown, is not current.";
};
app.connect().catch(() => {
  status.textContent =
    "This preview requires an MCP Apps-compatible host. The ordinary tool image remains available.";
});
