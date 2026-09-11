/* Browser checks for a local design artifact, not application/device acceptance. */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require(
  process.env.RIDR_PLAYWRIGHT_MODULE || "playwright",
);

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.RIDR_CHROME_EXECUTABLE
      ? { executablePath: process.env.RIDR_CHROME_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  const snapshotDir = process.env.RIDR_SCREENSHOT_DIR;
  if (snapshotDir) fs.mkdirSync(snapshotDir, { recursive: true });
  const results = [];
  const screen = async (key) => {
    await page.locator(`[data-screen="${key}"]`).click();
  };
  const role = (value) => page.locator("#role").selectOption(value);
  const scenario = (value) => page.locator("#scenario").selectOption(value);
  const network = (value) => page.locator("#network").selectOption(value);
  const movement = (value) => page.locator("#movement").selectOption(value);
  const action = (value) => page.locator(`[data-action="${value}"]`).first();
  const reset = () => page.locator("#reset").click();
  const contains = async (text) =>
    assert(
      (await page.locator("#screen").innerText()).includes(text),
      `Missing text: ${text}`,
    );
  const record = (text) => {
    results.push(text);
  };
  try {
    await page.goto(
      pathToFileURL(path.join(__dirname, "wireframes.html")).href,
    );
    const keys = await page
      .locator("[data-screen]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.screen));
    assert.equal(new Set(keys).size, 20);
    let renderCases = 0;
    let stateCases = 0;
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const mode of ["light", "sunlight"]) {
        await page.locator(`button[data-mode="${mode}"]`).click();
        for (const key of keys) {
          await screen(key);
          assert((await page.locator("#screen-title").textContent()).trim());
          const layout = await page.locator("#phone").evaluate((phone) => {
            const bounds = phone.getBoundingClientRect();
            const controls = [
              ...phone.querySelectorAll("button, input, select, textarea"),
            ];
            const small = controls
              .filter((el) => {
                const target =
                  el.type === "checkbox" ? el.closest("label") : el;
                const r = target.getBoundingClientRect();
                return r.width < 47.9 || r.height < 47.9;
              })
              .map((el) => el.textContent.trim() || el.name || el.id);
            return {
              overflow: phone.scrollWidth > phone.clientWidth + 1,
              right: bounds.right,
              small,
            };
          });
          assert.equal(
            layout.overflow,
            false,
            `${key}/${mode}/${width}: horizontal overflow`,
          );
          assert(
            layout.right <= width + 1,
            `${key}/${mode}/${width}: phone outside viewport`,
          );
          assert.deepEqual(
            layout.small,
            [],
            `${key}/${mode}/${width}: undersized touch target`,
          );
          if (snapshotDir && width === 1440) {
            await page.locator("#phone").screenshot({
              path: path.join(snapshotDir, `${mode}-${key}.png`),
            });
          }
          renderCases++;
        }
      }
    }
    record(
      `${renderCases} screen/mode/viewport combinations rendered; no horizontal overflow; controls meet 48px target.`,
    );
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('button[data-mode="light"]').click();
    for (const key of keys) {
      await screen(key);
      const options = await page
        .locator("#scenario option")
        .evaluateAll((nodes) => nodes.map((node) => node.value));
      for (const option of options) {
        await scenario(option);
        assert((await page.locator("#screen-title").textContent()).trim());
        stateCases++;
      }
    }
    record(`${stateCases} named screen states render without script errors.`);

    await screen("external");
    assert.equal(
      await page.locator("#screen [data-action]").count(),
      0,
      "External viewer must have no private navigation",
    );
    for (const text of ["Ravi", "Meera", "Om + Asha", "Chat"])
      assert(!(await page.locator("#screen").innerText()).includes(text));
    await scenario("expired");
    assert.equal(await page.locator("#screen .map-art").count(), 0);
    await reset();
    await network("offline");
    assert.equal(await page.locator("#screen .map-art").count(), 0);
    record(
      "External viewer has no private navigation or group data; expired/offline states clear map content.",
    );

    await network("online");
    for (const member of ["leader", "rider", "pillion"]) {
      await role(member);
      await screen("chat");
      for (const moving of ["moving", "unknown"]) {
        await movement(moving);
        assert.equal(await page.locator("#screen textarea").count(), 0);
        assert.equal(
          await page.locator('#screen [data-action="compose"]').count(),
          0,
        );
        assert(
          (await page.locator('#screen [data-action^="preset:"]').count()) >= 3,
        );
        assert.equal(await action("sos").isEnabled(), true);
      }
    }
    await movement("stopped");
    await role("pillion");
    await screen("chat");
    assert.equal(await page.locator("#screen textarea").count(), 0);
    await action("compose").click();
    assert.equal(await page.locator("#screen textarea").count(), 1);
    record(
      "All roles restrict composition in moving/unknown states; pillion stationary composer remains available.",
    );

    for (const member of ["rider", "pillion"]) {
      await role(member);
      await screen("end");
      assert.equal(
        await page.locator('#screen [data-action="end-ride"]').count(),
        0,
      );
      await screen("headcount");
      assert.equal(
        await page.locator('#screen [data-action="fresh-round"]').count(),
        0,
      );
    }
    await role("leader");
    await screen("lobby");
    assert.equal(await action("start").isDisabled(), true);
    await scenario("ready");
    await action("start").click();
    await contains("Permissions");
    await action("without-location").click();
    await contains("Location unavailable");
    assert.equal(await action("sos").isEnabled(), true);
    record(
      "Leader-only controls, readiness-gated start, and declining location preserve safety access.",
    );

    await screen("join");
    await scenario("active");
    await page.locator('#screen button[type="submit"]').click();
    await contains("Location unavailable");
    record("Explicit active join does not silently start location sharing.");

    for (const member of ["leader", "pillion"]) {
      await role(member);
      await screen("map");
      const expected =
        member === "pillion"
          ? ["Need a stop", "Uncomfortable pace", "Cold/Tired"]
          : ["Stopping", "Regrouping", "Flat tire", "Turn missed", "Car back"];
      for (const preset of expected)
        assert.equal(await action(`preset:${preset}`).isEnabled(), true);
    }
    for (const [connection, expected] of [
      ["online", "Accepted by server"],
      ["offline", "Not sent — offline"],
      ["uncertain", "Delivery unconfirmed"],
    ]) {
      await screen("map");
      await network(connection);
      await action("sos").click();
      await contains(expected);
      await action("go:map").click();
      assert.equal(await action("open-sos").isEnabled(), true);
      await action("open-sos").click();
      await contains(expected);
    }
    await action("resolve-sos").click();
    await action("go:map").click();
    await contains("Okay update pending");
    record(
      "Full role preset sets are one tap away; SOS delivery states persist on return and pending resolution.",
    );

    await screen("share");
    await network("online");
    await page.locator("#lifetime").selectOption({ label: "8 hours" });
    await action("create-link").click();
    await contains("Ends in 8 hours");
    await network("offline");
    await action("revoke-link").click();
    await contains("Revocation pending");
    await network("online");
    await action("stop-sharing").click();
    assert.equal(await action("create-link").isDisabled(), true);
    await action("go:map").click();
    await action("sos").click();
    await contains("Location unavailable");
    record(
      "Status-link lifetime works; offline revocation stays pending; stopping location prevents new live links and keeps SOS.",
    );

    await role("leader");
    await screen("pair");
    await scenario("consented");
    await network("offline");
    await action("pair").click();
    await contains("Pairing confirmation pending");
    assert.equal(
      await page.locator("#inspector-title").textContent(),
      "Pair a pillion",
    );
    await screen("headcount");
    await scenario("complete");
    assert.equal(await action("go:map").last().isEnabled(), true); // Header return is always available.
    assert.equal(
      await page.locator('#screen .btn[data-action="go:map"]').isDisabled(),
      true,
    );
    record("Offline pair and headcount confirmations do not appear complete.");

    await screen("end");
    await action("end-ride").click();
    await contains("End pending");
    await network("online");
    await action("end-ride").click();
    await contains("Your ride, recorded.");
    await screen("crash");
    await contains("Crash detection is off");
    await scenario("default");
    await action("dismiss-crash").click();
    await contains("No SOS sent");
    await screen("map");
    await action("go:share").click();
    await action("go:map").first().click();
    await action("sos").click();
    await action("go:map").click();
    await page.locator('[data-screen="home"]').click();
    await scenario("active");
    assert.equal(await page.locator(".sponsored").count(), 0);
    record(
      "Offline end requires acknowledgement; crash is conditional with one-tap dismissal; active home has no ads.",
    );

    const contrast = await page.locator("#phone").evaluate((phone) => {
      function luminance(hex) {
        let digits = hex.replace("#", "");
        if (digits.length === 3)
          digits = [...digits].map((x) => x + x).join("");
        const c = digits
          .match(/.{2}/g)
          .map((x) => parseInt(x, 16) / 255)
          .map((x) =>
            x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
          );
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      }
      const results = [];
      for (const mode of ["light", "sunlight"]) {
        phone.dataset.mode = mode;
        const c = getComputedStyle(phone);
        for (const [fg, bg] of [
          ["--ink", "--paper"],
          ["--muted", "--paper"],
          ["--muted", "--soft"],
          ["--primary", "--soft"],
          ["--paper", "--primary"],
          ["--paper", "--alert"],
          ["--alert", "--alert-bg"],
          ["--warning", "--warning-bg"],
        ]) {
          const a = luminance(c.getPropertyValue(fg).trim()),
            b = luminance(c.getPropertyValue(bg).trim());
          results.push({
            mode,
            fg,
            bg,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          });
        }
      }
      return results;
    });
    for (const pair of contrast)
      assert(pair.ratio >= 4.5, JSON.stringify(pair));
    record(
      `16 core text/background combinations pass 4.5:1; lowest ratio ${Math.min(...contrast.map((x) => x.ratio)).toFixed(2)}:1.`,
    );
    await screen("map");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "screen-title",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.action),
      "sos",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    const presetBounds = await action("preset:Stopping").boundingBox();
    await page.mouse.move(presetBounds.x + 10, presetBounds.y + 10);
    await page.mouse.down();
    assert.equal(
      await action("preset:Stopping").evaluate(
        (el) => getComputedStyle(el).transform,
      ),
      "none",
    );
    await page.mouse.up();
    record(
      "Navigation focuses the screen title, Tab reaches SOS, and reduced motion removes pressed scaling.",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    console.log(
      JSON.stringify(
        {
          status: "passed",
          checks: results,
          browser: await browser.version(),
          pageErrors: errors,
          externalRequests,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
