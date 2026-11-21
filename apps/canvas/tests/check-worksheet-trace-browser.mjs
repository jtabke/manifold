import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { readWorkspace, startWriting } from "./browser-workspace.mjs";
// Measure the actual painted paths against independently read notation. An
// endpoint on the correct name is not enough if the wire cut through another row.
function inkCrossings(page) {
  return page.evaluate(() => {
    const svg = document.querySelector(".er-trace-wires"),
      hits = new Set();
    const ink = [
      ...document.querySelectorAll(
        ".er-paper .er-math-line :is(mi,mn,mo,mtext),.er-paper .er-result,.er-paper .er-condition,.er-paper .er-note",
      ),
    ].map((el) => [el.textContent, el.getBoundingClientRect()]);
    for (const path of svg.querySelectorAll(
      "[data-trace-wire],[data-trace-trunk],[data-trace-lead]",
    )) {
      const length = path.getTotalLength(),
        ctm = path.getScreenCTM();
      for (let i = 0; i <= length; i += 1.5) {
        const p = path.getPointAtLength(i).matrixTransform(ctm);
        for (const [name, r] of ink)
          if (p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom)
            hits.add(name);
      }
    }
    return [...hits];
  });
}
const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(7500);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  await startWriting(page);
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  for (const t of [
    "I := 2 A",
    "R := 6 ohm",
    "U = I*R",
    "P = U*I",
    "sq = I*I",
    "P <= 100 W",
  ]) {
    await editor.fill(t);
    await editor.press("Enter");
  }
  await editor.press("Escape");
  const saved = async () => (await readWorkspace(page)).page,
    baseline = await saved();
  const id = (name) =>
    baseline.regions.find((r) => r.text.startsWith(name + " ")).id;
  const row = (name) => page.locator(`[data-region-id="${id(name)}"]`),
    tray = page.getByRole("complementary", {
      name: "Trace values",
      exact: true,
    }),
    wires = page.locator("[data-trace-wire]");
  await expect(tray).toHaveCount(0);
  await expect(wires).toHaveCount(0);
  await page
    .getByRole("button", { name: "Inspect result P", exact: true })
    .click();
  await expect(tray.getByRole("heading")).toBeFocused();
  await expect(
    tray.getByRole("button", { name: "Symbols", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(wires).toHaveCount(1);
  await expect(row("P").locator("[data-trace-use]")).toHaveText("U");
  // Choosing an authored symbol changes the source, not the consuming equation.
  await row("P")
    .getByRole("button", { name: /^Trace I in P:/ })
    .click();
  await expect(row("P").locator("[data-trace-use]")).toHaveText("I");
  await expect(row("U").locator("[data-trace-use]")).toHaveCount(0);
  await expect(wires).toHaveCount(1);
  await tray
    .getByRole("button", { name: "Trace input U", exact: true })
    .click();
  await expect(
    row("P").locator(`[data-trace-use="${id("U")}"] .er-scrubbable`),
  ).toHaveCount(0);
  await tray
    .getByRole("button", { name: "Show uses of P", exact: true })
    .click();
  await expect(
    page.locator(`[data-kind="constraint"] [data-trace-use="${id("P")}"]`),
  ).toHaveText("P");
  await expect(wires).toHaveCount(1);
  await tray
    .getByRole("button", { name: "Show inputs to P", exact: true })
    .click();
  await tray
    .getByRole("button", { name: "Trace input I", exact: true })
    .click();
  await tray.getByRole("button", { name: "Values", exact: true }).click();
  await expect(
    row("P").getByRole("button", { name: "Vary I in P" }),
  ).toHaveText("2 A");
  await tray.getByRole("button", { name: "Symbols", exact: true }).click();
  await expect(
    row("P").getByRole("button", { name: "Trace I in P" }),
  ).toHaveText("I");
  await tray.getByRole("button", { name: "Values", exact: true }).click();
  const chip = tray.getByRole("button", { name: /^Vary I:/ });
  await tray
    .getByRole("button", { name: "Show uses of I", exact: true })
    .click();
  await expect(wires).toHaveCount(4);
  await expect(
    page.locator(`[data-trace-to="${id("sq")}"] [data-trace-trunk]`),
  ).toHaveCount(1);
  await expect(
    page.locator(`[data-trace-to="${id("sq")}"] [data-trace-wire]`),
  ).toHaveCount(2);
  const uses = row("sq").locator(`[data-trace-use="${id("I")}"]`);
  await expect(uses).toHaveCount(2);
  expect(
    await uses.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-source-start")),
    ),
  ).toEqual(["5", "7"]);
  // Wire endpoints, not just edge counts, must continue to match both distinct terms under zoom.
  const endpointsMatch = () =>
    uses.evaluateAll((nodes) => {
      const svg = document.querySelector(".er-trace-wires");
      const ends = [...svg.querySelectorAll("[data-trace-wire]")].map((path) =>
        path
          .getPointAtLength(path.getTotalLength())
          .matrixTransform(svg.getScreenCTM()),
      );
      return nodes.every((n) => {
        const r = n.getBoundingClientRect();
        return ends.some(
          (p) =>
            Math.abs(p.x - r.x - r.width / 2) < 2 &&
            Math.abs(p.y - r.top + 2) < 1,
        );
      });
    });
  await expect.poll(endpointsMatch).toBe(true);
  await page.getByLabel("Zoom out", { exact: true }).click();
  await expect.poll(endpointsMatch).toBe(true);
  await expect.poll(() => inkCrossings(page)).toEqual([]);
  const input = uses.last().getByRole("button");
  const center = async (loc) => {
    const b = await loc.boundingBox();
    expect(b).toBeTruthy();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const drag = async (loc, dx) => {
    const c = await center(loc);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + dx, c.y, { steps: 5 });
  };
  await drag(input, 90); // 2 A + 90*(2/180) = 3 A.
  await expect(row("P").locator(".er-result")).toContainText("54 W");
  expect(await saved()).toEqual(baseline);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(row("P").locator(".er-result")).toContainText("24 W");
  expect(await saved()).toEqual(baseline);
  await expect(tray).toBeVisible();
  // Double I: it contributes to P both directly and through U.
  await drag(input, 180);
  await page.mouse.up();
  await expect(row("P").locator(".er-result")).toContainText("96 W");
  const edited = await saved();
  expect(
    edited.regions
      .filter((r, ix) => r.text !== baseline.regions[ix].text)
      .map((r) => r.id),
  ).toEqual([id("I")]);
  const undo = page.getByLabel("Undo", { exact: true });
  await undo.click();
  expect(await saved()).toEqual(baseline);
  await drag(chip, -90);
  await expect(row("P").locator(".er-result")).toContainText("6 W");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(row("P").locator(".er-result")).toContainText("24 W");
  await chip.focus();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await expect(row("P").locator(".er-result")).not.toContainText("24 W");
  expect(
    (await saved()).regions.find((r) => r.id === id("I")).text,
  ).not.toEqual(baseline.regions.find((r) => r.id === id("I")).text);
  await page.keyboard.press("Control+z");
  expect(await saved()).toEqual(baseline);
  // Shrinking the viewport leaves distant consumers in an accessible list.
  await page.setViewportSize({ width: 1000, height: 340 });
  await row("I").scrollIntoViewIfNeeded();
  await expect(tray.locator("summary")).toContainText(
    "without a visible route",
  );
  await tray.locator("summary").click();
  await tray.getByRole("button", { name: "I → sq", exact: true }).click();
  await expect(tray.getByRole("heading")).toContainText("sq");
  await expect(row("sq")).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Inspect result P", exact: true })
    .click();
  await tray.getByRole("button", { name: "Follow definition of U" }).click();
  await expect(tray.locator("header")).toContainText("U");
  await row("I").scrollIntoViewIfNeeded();
  await expect(wires).toHaveCount(1);
  await tray.getByRole("button", { name: "Close value trace" }).press("Escape");
  await expect(
    row("U").getByRole("button", { name: "Inspect result U", exact: true }),
  ).toBeFocused();
  await expect(wires).toHaveCount(0);
  await expect(
    row("sq").getByRole("button", { name: "Edit I", exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await expect(tray).toHaveCount(0);
  expect(await saved()).toEqual(baseline);
  // When the badge has no result, the region command must still explain why.
  await row("I")
    .getByRole("button", { name: "Edit value 2", exact: true })
    .dblclick();
  await editor.fill("I := missing_input");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await row("P")
    .getByRole("button", { name: "Edit I", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Context actions" }),
  ).toHaveAttribute("aria-description", /Term I in P/);
  await page
    .getByRole("menuitem", { name: "Trace values", exact: true })
    .click();
  await expect(tray).toContainText(/Unresolved:.*I/);
  await expect(wires).toHaveCount(0);
  await expect(tray.getByRole("button", { name: /^Vary / })).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await tray
    .getByRole("button", { name: "Trace input I", exact: true })
    .click();
  await expect(tray.getByRole("button", { name: /^Vary I:/ })).toBeVisible();
  expect(await saved()).toEqual(baseline);
  await nestedFlow(browser, errors);
  expect(errors).toEqual([]);
  console.log(
    "Trace values: real occurrence wires and zoom, symbolic/value inspection, upstream navigation, source-only scrubbing, Escape, grouped keyboard and pointer Undo, quiet editing and cold reload pass.",
  );
} finally {
  await browser.close();
}

async function nestedFlow(browser, errors) {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1120 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  await startWriting(page);
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  for (const text of [
    "D_1 := 100 mm",
    "d_t := 50 mm",
    "C_d := 0.98",
    "A_t = pi*d_t^2/4",
    "beta = d_t/D_1",
    "p_drop := 7500 Pa",
    "rho := 1000 kg/m^3",
    "Q = C_d*A_t*sqrt((2*p_drop)/(rho*(1-beta^4)))",
    "Q >= 0.006 m^3/s",
  ]) {
    await editor.fill(text);
    await editor.press("Enter");
  }
  await editor.press("Escape");
  const badge = page.getByRole("button", {
      name: "Inspect result Q",
      exact: true,
    }),
    line = badge.locator(".."),
    tray = page.getByRole("complementary", {
      name: "Trace values",
      exact: true,
    });
  const select = (name) =>
    tray
      .getByRole("button", { name: "Trace input " + name, exact: true })
      .click();
  const wire = page.locator("[data-trace-wire]");
  const mathBounds = () =>
    line
      .locator("math [data-symbol]")
      .evaluateAll((nodes) =>
        nodes.map((el) => [
          el.dataset.symbol,
          el.getBoundingClientRect().x,
          el.getBoundingClientRect().y,
        ]),
      );
  const radical = line.locator("msqrt");
  await expect(radical).toHaveAttribute("data-radical-painted", "");
  await page.evaluate(() => document.fonts.ready);
  const radicalSize = await radical.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      arg = el.firstElementChild.getBoundingClientRect();
    return { lead: arg.left - r.left, gap: arg.top - r.top, width: r.width };
  });
  // Read the pixels in the join, not just the presence of an SVG background.
  // The native tall radical puts the long bar a few pixels above its left stroke.
  const png = await radical.screenshot();
  const joined = await page.evaluate(
    async ({ data, size }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      const scale = img.width / size.width;
      const left = Math.round((size.lead - 1.5) * scale),
        right = Math.round((size.lead + 10) * scale);
      for (let y = 0; y < Math.floor(size.gap * scale); y++) {
        let solid = true;
        for (let x = left; x < right; x++)
          if (pixels[(y * img.width + x) * 4] < 140) {
            solid = false;
            break;
          }
        if (solid) return true;
      }
      return false;
    },
    { data: png.toString("base64"), size: radicalSize },
  );
  expect(joined).toBe(true);
  await line
    .getByRole("button", { name: "Edit p_drop", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Trace values", exact: true })
    .click();
  await expect(
    tray.getByRole("button", { name: "Trace input p_drop" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    line.locator("msqrt mfrac > :first-child [data-trace-use]"),
  ).toHaveAttribute("data-symbol", "p_drop");
  await expect(wire).toHaveCount(1);
  const approachFromAbove = () =>
    line.evaluate((el) => {
      const path = document.querySelector("[data-trace-wire]"),
        lead = document.querySelector("[data-trace-lead]"),
        trunk = document.querySelector("[data-trace-trunk]");
      const term = el.querySelector("[data-trace-use]");
      if (!path || !lead || !trunk || !term) return false;
      const at = (p, offset = 0) =>
        p.getPointAtLength(offset).matrixTransform(p.getScreenCTM());
      const last = (p) => at(p, p.getTotalLength());
      const end = last(path),
        prev = at(path, path.getTotalLength() - 1);
      const r = (
        term.querySelector("msub > :first-child") ?? term
      ).getBoundingClientRect();
      const root = term.closest("msqrt").getBoundingClientRect();
      const start = at(trunk),
        origin = document
          .querySelector("[data-trace-origin]")
          .getBoundingClientRect(),
        beforeBar = last(lead),
        afterBar = at(path);
      return (
        Math.abs(start.x - origin.left - origin.width / 2) < 1 &&
        Math.abs(start.y - origin.bottom - 2) < 1 &&
        Math.abs(end.x - r.x - r.width / 2) < 1 &&
        Math.abs(end.y - r.top + 2) < 1 &&
        prev.y < end.y &&
        Math.abs(beforeBar.x - end.x) < 1 &&
        Math.abs(afterBar.x - end.x) < 1 &&
        beforeBar.y < afterBar.y &&
        afterBar.y - beforeBar.y > 3 &&
        beforeBar.y < root.top + 5 &&
        afterBar.y > root.top + 3 &&
        start.y < el.getBoundingClientRect().top &&
        at(lead).y <= el.getBoundingClientRect().top &&
        trunk.getTotalLength() + lead.getTotalLength() + path.getTotalLength() <
          Math.abs(end.x - start.x) + Math.abs(end.y - start.y) + 5
      );
    });
  await expect.poll(approachFromAbove).toBe(true);
  await expect.poll(() => inkCrossings(page)).toEqual([]);
  const original = await mathBounds();
  await select("rho");
  await expect(
    line.locator("msqrt mfrac > :last-child [data-trace-use]"),
  ).toHaveAttribute("data-symbol", "rho");
  await expect(page.locator("[data-trace-lead]")).toHaveCount(0);
  const approachFromBelow = () =>
    line.evaluate((el) => {
      const path = document.querySelector("[data-trace-wire]");
      if (!path) return false;
      const l = path.getTotalLength(),
        end = path.getPointAtLength(l).matrixTransform(path.getScreenCTM()),
        prev = path
          .getPointAtLength(l - 2)
          .matrixTransform(path.getScreenCTM()),
        r = el.querySelector("[data-trace-use]").getBoundingClientRect();
      return (
        Math.abs(end.x - r.x - r.width / 2) < 1 &&
        Math.abs(end.y - r.bottom - 2) < 1 &&
        prev.y > end.y
      );
    });
  await expect.poll(approachFromBelow).toBe(true);
  expect(await mathBounds()).toEqual(original);
  await expect.poll(() => inkCrossings(page)).toEqual([]);
  await select("p_drop");
  await expect.poll(approachFromAbove).toBe(true);
  // Move a non-endpoint over the numerator itself. There may still be empty
  // space below the equation, but a wire to a copy of the name isn't a route.
  const obstacle = page
    .locator('math:has([data-expression-for="D_1"])')
    .locator("xpath=ancestor::section[1]");
  await obstacle.evaluate((host) => {
    const a = host.querySelector("math").getBoundingClientRect(),
      b = document
        .querySelector("msqrt [data-trace-use]")
        .getBoundingClientRect();
    host.style.translate = `${b.left - a.left - 12}px ${b.top - a.top - 10}px`;
  });
  await expect(wire).toHaveCount(0);
  await expect(line.locator("[data-trace-use]")).toHaveAttribute(
    "data-symbol",
    "p_drop",
  );
  await expect(tray.locator("summary")).toContainText(
    "without a visible route",
  );
  await obstacle.evaluate((host) => {
    host.style.translate = "";
  });
  await expect.poll(approachFromAbove).toBe(true);
  await tray.getByRole("button", { name: "Values", exact: true }).click();
  await expect(line.locator("[data-trace-use]")).toHaveText("7500 Pa");
  await expect
    .poll(() =>
      line.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [...el.querySelectorAll("mi,mtext,mn,mo,.er-result")].every(
          (n) => {
            const b = n.getBoundingClientRect();
            return (
              b.left >= r.left - 1 &&
              b.right <= r.right + 1 &&
              b.bottom <= r.bottom + 1
            );
          },
        );
      }),
    )
    .toBe(true);
  // Numeric working fills the small gap under the bar. Keep the value
  // highlighted but don't cram an arrow into the rule or the value.
  await expect(wire).toHaveCount(0);
  await expect(tray.locator("summary")).toContainText(
    "without a visible route",
  );
  await tray.getByRole("button", { name: "Symbols", exact: true }).click();
  await page.getByLabel("Zoom out", { exact: true }).click();
  await expect.poll(approachFromAbove).toBe(true);
  await expect.poll(() => inkCrossings(page)).toEqual([]);
  const control = tray.getByRole("button", { name: /^Vary p_drop:/ }),
    r = await control.boundingBox();
  const x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 135, y, { steps: 8 });
  await expect(badge).toContainText("0.00384845");
  await expect(page.locator(".er-condition")).toContainText("Not satisfied");
  await expect.poll(approachFromAbove).toBe(true);
  await expect.poll(() => inkCrossings(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(badge).toContainText("0.0076969");
  await expect(tray).toBeVisible();
  await page.close();
}
