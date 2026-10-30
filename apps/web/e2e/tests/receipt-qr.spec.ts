import { createRequire } from "node:module";

import type jsQR from "jsqr";

import { expect, test } from "../fixtures";

const require = createRequire(import.meta.url);
for (const theme of ["light", "dark"] as const) {
  test(`receipt QR screenshot decodes in ${theme} at 375`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/dev/deposit-states?state=done");
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    const qr = page.getByTestId("receipt-qr");
    await expect(qr).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const image = await qr.screenshot();
    await page.addScriptTag({ path: require.resolve("jsqr") });
    const decoded = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height);
      return (window as unknown as { jsQR: typeof jsQR }).jsQR(pixels.data, pixels.width, pixels.height)?.data;
    }, image.toString("base64"));
    expect(decoded).toBe(
      await page.getByRole("link", { name: "Open the transaction", exact: true }).getAttribute("href"),
    );
    expect(await page.getByTestId("qr-stub").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    for (const extension of ["PNG", "SVG"]) {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: `Download ${extension}` }).click();
      expect((await download).suggestedFilename()).toBe(`kickback-ticket.${extension.toLowerCase()}`);
    }
  });
}
