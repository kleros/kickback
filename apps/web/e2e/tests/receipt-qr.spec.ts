import { readFile } from "node:fs/promises";

import type jsQR from "jsqr";


import { expect, test } from "../fixtures";

// phones render at 2-3x; at 1x a 224 px QR of a long URL is about 4 px per module, below what jsQR resolves
test.use({ deviceScaleFactor: 3 });

for (const theme of ["light", "dark"] as const) {
  test(`receipt QR screenshot decodes in ${theme} at 375`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/dev/deposit-states?state=done");
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    const qr = page.getByTestId("receipt-qr");
    await expect(qr).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const image = await qr.screenshot({ scale: "device" });
    await page.addScriptTag({ path: require.resolve("jsqr") });
    const decode = (png: Buffer) => page.evaluate(async (base64) => {
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
    }, png.toString("base64"));
    const href = await page.getByRole("link", { name: "Open the transaction", exact: true }).getAttribute("href");
    expect(await decode(image)).toBe(href);
    expect(await page.getByTestId("qr-stub").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    for (const extension of ["PNG", "SVG"]) {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: `Download ${extension}` }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(`kickback-ticket.${extension.toLowerCase()}`);
      if (extension === "PNG") expect(await decode(await readFile((await file.path())!))).toBe(href);
    }
  });
}
