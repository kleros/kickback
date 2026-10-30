import { buildEventInfo, ipfsCidV0, KLEROS_IPFS_GATEWAY, serializeEventInfo } from "@kickback/core";

import { expect, test } from "../fixtures";
import { deployOrganiserEvent } from "../utils/organiser";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8c8AAAAASUVORK5CYII=",
  "base64",
);
const cover = { path: `/ipfs/${ipfsCidV0(png)}`, bytes: png.length, mime: "image/png" as const };
const description = "Dinner with friends. ".repeat(20);
const json = serializeEventInfo(
  buildEventInfo({ description, cover, links: [{ label: "Hosts", url: "https://example.com/hosts" }] }),
);
const infoPath = `/ipfs/${ipfsCidV0(json)}`;

test("phone: verified poster, disclosure, preview and consent-only map", async ({ page }) => {
  const event = await deployOrganiserEvent("Poster dinner", 3600, {
    eventInfo: infoPath,
    details: { eventTitle: "Poster dinner", eventWhere: "Café & Hall #2", hosts: "Friends, Neighbours" },
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route(`${KLEROS_IPFS_GATEWAY}${infoPath}`, (route) =>
    route.fulfill({ body: json, contentType: "application/json" }),
  );
  await page.route(`${KLEROS_IPFS_GATEWAY}${cover.path}`, (route) =>
    route.fulfill({ body: png, contentType: "image/png" }),
  );
  await page.route("**/api/preview?*", (route) =>
    route.fulfill({ json: { title: "Join the dinner", siteName: "Luma", image: "/api/preview/image?url=fixture" } }),
  );
  await page.route("**/api/preview/image?*", (route) => route.fulfill({ body: png, contentType: "image/png" }));
  let mapRequests = 0;
  await page.route("https://www.google.com/**", async (route) => {
    mapRequests++;
    await route.fulfill({ body: "<html>Map</html>", contentType: "text/html" });
  });
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  const details = page.getByTestId("event-details");
  await expect(details.locator(".ed-cover")).toHaveAttribute("src", /^blob:/);
  await expect(details.getByRole("heading", { name: "Poster dinner" })).toBeVisible();
  await expect(details.getByRole("link", { name: /Join the dinner/ })).toContainText("luma.com");
  await expect(details.getByText("Neighbours")).toBeVisible();
  await details.getByRole("button", { name: "Read more" }).click();
  await expect(details.getByRole("button", { name: "Read more" })).toHaveAttribute("aria-expanded", "true");
  expect(mapRequests).toBe(0);
  await expect(details.locator("iframe")).toHaveCount(0);
  await details.getByRole("button", { name: "Show map" }).click();
  await expect(details.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
  await expect(details.locator("iframe")).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect.poll(() => mapRequests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("phone: preview failure and absent info retain only on-chain details", async ({ page }) => {
  const event = await deployOrganiserEvent("On-chain dinner", 3600);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route("**/api/preview?*", (route) => route.fulfill({ status: 502, body: "Unavailable" }));
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  const details = page.getByTestId("event-details");
  await expect(details.getByRole("link", { name: /Open registration/ })).toContainText("luma.com");
  await expect(details.locator(".ed-cover")).toHaveCount(0);
  await expect(details.getByLabel("Extra links")).toHaveCount(0);
  await expect(details.getByText("Local test venue")).toBeVisible();
});

test("phone: a CID mismatch never displays the unverified cover", async ({ page }) => {
  const event = await deployOrganiserEvent("Bad cover", 3600, { eventInfo: infoPath });
  await page.route(`${KLEROS_IPFS_GATEWAY}${infoPath}`, (route) =>
    route.fulfill({ body: json, contentType: "application/json" }),
  );
  let coverFetched = false;
  await page.route(`${KLEROS_IPFS_GATEWAY}${cover.path}`, async (route) => {
    coverFetched = true;
    await route.fulfill({ body: "tampered", contentType: "image/png" });
  });
  await page.route("**/api/preview?*", (route) => route.fulfill({ status: 502 }));
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  await expect.poll(() => coverFetched).toBe(true);
  await expect(page.getByTestId("event-details").locator(".ed-cover")).toHaveCount(0);
  await expect(page.getByTestId("event-details").getByRole("button", { name: "Read more" })).toBeVisible();
});

test("create: description, cover and extra links appear in the guest preview", async ({ page }) => {
  await page.goto("/organise/new");
  await page.getByLabel("Title", { exact: true }).fill("A new dinner");
  await page.getByLabel("Description", { exact: true }).fill("Come meet the hosts.");
  await page.getByRole("textbox", { name: "Extra links" }).fill("Hosts | https://example.com/hosts");
  await page
    .getByLabel("Cover image", { exact: true })
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  const preview = page.getByLabel("Guest page preview");
  await expect(preview.getByRole("heading", { name: "A new dinner" })).toBeVisible();
  await expect(preview.getByText("Come meet the hosts.")).toBeVisible();
  await expect(preview.locator(".ed-cover")).toHaveAttribute("src", /^blob:/);
  await expect(preview.getByRole("link", { name: /Hosts/ })).toContainText("example.com");
});
