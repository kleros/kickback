import { writeFile } from "node:fs/promises";
import path from "node:path";

import { GALLERY_STATES } from "@/features/event/model/fixtures";

import { expect, test } from "../fixtures";
import { pageWords } from "../utils/pageWords";
import { suiteEvent } from "../utils/suiteEvent";

// eslint-disable-next-line turbo/no-undeclared-env-vars -- a local opt-in, never set in CI
const DIR = process.env.E2E_SHOTS_DIR;
const WIDTHS = [375, 1280] as const;
const THEMES = ["light", "dark"] as const;

test.describe("screenshots", () => {
  test.skip(!DIR, "set E2E_SHOTS_DIR to write screenshots");
  test.setTimeout(600_000);

  for (const theme of THEMES)
    for (const width of WIDTHS)
      test(`${theme} at ${width}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
        const shot = async (name: string, fullPage = false) => {
          await page.screenshot({ path: path.join(DIR!, `${name}-${width}-${theme}.png`), fullPage });
          if (width === 1280 && theme === "light") await writeFile(path.join(DIR!, `${name}.txt`), await pageWords(page));
        };

        for (const state of GALLERY_STATES) {
          await page.goto(`/dev/deposit-states?state=${state}`);
          await expect(page.getByTestId("ticket")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await shot(`state-${state}`);
        }

        const { contract } = suiteEvent();
        await page.goto(`/event/${contract}`);
        await expect(page.getByTestId("ticket")).toHaveAttribute("data-state", "rest");
        await expect(page.getByTestId("how-sum")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await shot("event");
        await shot("event-full", true);

        await page.getByRole("button", { name: "Proof of Presence contract" }).click();
        await shot("event-verified");

        await page.goto(`/event/0x000000000000000000000000000000000000dEaD`);
        await expect(page.getByTestId("refusal")).toBeVisible();
        await shot("refusal");
      });
});
