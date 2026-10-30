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

    // no status line is cut off at this width
    const clipped = await page
      .locator(".tk-slot p, .tk-foot, .tk-rcpt .v")
      .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    expect(clipped).toEqual([]);

    // the live card at rest has the same height, and its skeleton too
    await page.goto(`/event/${suiteEvent().contract}`);
    await expect(page.getByTestId("ticket")).toHaveAttribute("data-state", "rest");
    const live = await page.getByTestId("ticket").evaluate((c) => c.getBoundingClientRect().height);
    expect(live).toBeCloseTo(first, 1);
  });
