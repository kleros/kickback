import { GALLERY_STATES } from "@/features/event/model/fixtures";

import { expect, test } from "../fixtures";
import { suiteEvent } from "../utils/suiteEvent";

/** One footprint: the deposit card measures the same height in every state, at a phone and a desktop width. */
for (const width of [375, 1280] as const)
  test(`the deposit card keeps one height across every state at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/deposit-states");
    await expect(page.locator("[data-gallery-state]")).toHaveCount(GALLERY_STATES.length);
    await page.evaluate(() => document.fonts.ready);

    const heights = await page
      .getByTestId("ticket")
      .evaluateAll((cards) =>
        cards.map((c) => [c.getAttribute("data-state"), c.getBoundingClientRect().height] as const),
      );
    const first = heights[0]![1];
    for (const [state, height] of heights) expect.soft(height, `${state}`).toBeCloseTo(first, 1);

    for (const state of ["done", "already"]) {
      const receipt = page.locator(`[data-gallery-state="${state}"]`);
      await expect(receipt.getByTestId("share-row")).toBeVisible();
      await expect(receipt.getByTestId("qr-stub")).toBeVisible();
      const ticket = await receipt.getByTestId("ticket").boundingBox();
      const extras = await receipt.getByTestId("receipt-extras").boundingBox();
      expect(extras!.y).toBeGreaterThanOrEqual(ticket!.y + ticket!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // No status line or exact amount overflows at this width.
    const clipped = await page
      .locator(".tk-slot p, .tk-foot, .tk-rcpt .v, .tk-hero")
      .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    expect(clipped).toEqual([]);

    // the shipped face has tabular figures: digits are equal width, so a ticking timer does not jitter
    const widths = await page
      .locator(".tk-amount")
      .first()
      .evaluate((el) =>
        ["0.01", "1.11", "8.88"].map((text) => {
          const probe = el.cloneNode() as HTMLElement;
          probe.textContent = text;
          probe.style.position = "absolute";
          el.parentElement!.appendChild(probe);
          const width = probe.getBoundingClientRect().width;
          probe.remove();
          return width;
        }),
      );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.5);

    // the live card at rest has the same height
    await page.goto(`/event/${suiteEvent().contract}`);
    await expect(page.getByTestId("ticket")).toHaveAttribute("data-state", "rest");
    // after its entrance: the rise scales the card while it plays
    const live = await page.getByTestId("ticket").evaluate(async (c) => {
      await Promise.all(c.getAnimations().map((a) => a.finished));
      return c.getBoundingClientRect().height;
    });
    expect(live).toBeCloseTo(first, 1);
  });
