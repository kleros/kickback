import path from "node:path";

import { ipfsCidV0, KLEROS_IPFS_GATEWAY, KLEROS_IPFS_UPLOAD } from "@kickback/core";
import type { Address } from "viem";

import { GENERIC_POLICY_TEXT } from "@/features/organise/model/policy";

import { expect, test, type Page } from "../fixtures";
import {
  balanceOf,
  deployOrganiserEvent,
  deposit,
  guestAccounts,
  lumaCsv,
  register,
  type LumaGuest,
} from "../utils/organiser";
import { suiteEvent } from "../utils/suiteEvent";

// eslint-disable-next-line turbo/no-undeclared-env-vars -- a local opt-in, never set in CI
const SHOTS = process.env.E2E_ORGANISER_SHOTS_DIR;
const DAY = 86_400;

/** Each route and key state at 375 and 1280, light and dark, when E2E_ORGANISER_SHOTS_DIR is set. */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  const size = page.viewportSize();
  for (const theme of ["light", "dark"] as const)
    for (const width of [375, 1280]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${width}-${theme}.png`), fullPage: true });
    }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  if (size) await page.setViewportSize(size);
}

const organise = (address: Address, block: number, tab = "") =>
  `/organise/${address}${tab ? `/${tab}` : ""}?from=${block}`;

async function openAs(page: Page, wallet: { connect: (name: "alice") => Promise<void> }, url: string) {
  await page.goto(url);
  await wallet.connect("alice");
  await expect(page.getByTestId("phase")).toBeVisible({ timeout: 30_000 });
}

/** Types each word the dialog asks for, then presses its action. */
async function confirmTyped(page: Page, action: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("frozen")).toBeVisible();
  for (const label of await dialog.locator(".og-label").allTextContents()) {
    const word = /^Type (\w+) to confirm$/.exec(label)?.[1];
    if (word) await dialog.getByLabel(label).fill(word);
  }
  await dialog.getByRole("button", { name: action, exact: true }).click();
}

const row = (page: Page, wallet: Address) =>
  page.locator(`[data-testid="guest-row"][data-wallet="${wallet.toLowerCase()}"]`);

test.describe.configure({ mode: "serial" });

test.describe("organiser", () => {
  test.setTimeout(240_000);

  test("creates an event with the mock wallet; the overview and the guest page read it", async ({ page, wallet }) => {
    const cid = ipfsCidV0(GENERIC_POLICY_TEXT);
    await page.route(`${KLEROS_IPFS_UPLOAD}**`, (route) => route.fulfill({ json: { cid } }));
    await page.route(`${KLEROS_IPFS_GATEWAY}/ipfs/**`, (route) => route.fulfill({ body: GENERIC_POLICY_TEXT }));

    await page.goto("/organise");
    await shoot(page, "organise");
    await page.getByTestId("create-event").click();
    await expect(page.getByTestId("create")).toBeVisible();
    await wallet.connect("alice");

    const form = page.getByTestId("create-form");
    await form.getByLabel("Title").fill("Organiser Rehearsal");
    await form.getByLabel("Short name").fill("Rehearsal");
    await form.getByLabel("Venue").fill("Bandra Kurla Complex, Mumbai");
    await form.getByLabel("Hosts").fill("Kleros");
    await form.getByLabel("Registration link").fill("https://luma.com/rehearsal");
    await expect(page.getByTestId("case-text")).toContainText("Organiser Rehearsal");
    await shoot(page, "create");

    await page.getByRole("button", { name: "Deploy" }).click();
    await expect(page.getByTestId("deployed")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("browser-events")).toContainText("Rehearsal");
    await shoot(page, "create-deployed");

    const guestLink = (await page.getByTestId("guest-link").textContent())!;
    const address = /\/event\/(0x[0-9a-fA-F]{40})/.exec(guestLink)![1]!;
    await page.getByTestId("open-event").click();
    await expect(page.getByTestId("event-name")).toHaveText("Rehearsal", { timeout: 30_000 });
    await expect(page.getByTestId("phase")).toHaveText("Waiting for the event");
    await expect(page.getByTestId("overview")).toBeVisible();

    await page.goto(guestLink);
    await expect(page).toHaveURL(new RegExp(`/event/${address}`));
    await expect(page.getByTestId("ticket")).toHaveAttribute("data-state", /rest|ready/, { timeout: 30_000 });
  });

  test("guests: a Luma list ticks, registers and refunds; a deposit after the check refuses the send", async ({
    page,
    wallet,
  }) => {
    const event = await deployOrganiserEvent("Guests Night", 2 * DAY);
    const [a, b, c, d, late] = await guestAccounts(5);
    const guests: LumaGuest[] = [];
    for (const w of [a!, b!, c!, d!]) guests.push({ wallet: w, tx: await deposit(event.address, w) });

    await openAs(page, wallet, organise(event.address, event.deployBlock, "guests"));
    await expect(page.getByTestId("guest-row")).toHaveCount(4, { timeout: 30_000 });
    await page.getByTestId("luma-csv").setInputFiles({
      name: "luma-guests.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lumaCsv(guests)),
    });
    await expect(page.getByTestId("selection")).toContainText("4 selected", { timeout: 30_000 });
    await shoot(page, "guests");

    await row(page, a!)
      .getByRole("checkbox", { name: /^Register/ })
      .uncheck();
    await row(page, b!)
      .getByRole("checkbox", { name: /^Register/ })
      .uncheck();
    await row(page, d!)
      .getByRole("checkbox", { name: /^Register/ })
      .uncheck();
    await row(page, c!)
      .getByRole("checkbox", { name: /^Refund/ })
      .check();
    await page.getByRole("button", { name: "Refund 1", exact: true }).click();
    await expect(page.getByTestId("done")).toHaveText("Refunded 1.", { timeout: 30_000 });
    await expect(row(page, c!)).toContainText("Refunded");

    await row(page, a!)
      .getByRole("checkbox", { name: /^Register/ })
      .check();
    await row(page, b!)
      .getByRole("checkbox", { name: /^Register/ })
      .check();
    await page.getByRole("button", { name: "Register 2", exact: true }).click();
    await expect(page.getByTestId("done")).toHaveText("Registered 2.", { timeout: 30_000 });
    await expect(row(page, a!)).toContainText("Registered");

    await row(page, d!)
      .getByRole("checkbox", { name: /^Register/ })
      .check();
    await deposit(event.address, late!);
    await page.getByRole("button", { name: "Register 1", exact: true }).click();
    await expect(page.getByTestId("error")).toContainText("The contract changed since the check");
    await shoot(page, "guests-refused");
  });

  test("more menu: cancelling a fresh event refunds the registered stakers", async ({ page, wallet }) => {
    const event = await deployOrganiserEvent("Cancelled Night", 2 * DAY);
    const stakers = await guestAccounts(2);
    for (const w of stakers) await deposit(event.address, w);
    await register(event.address, stakers);
    const before = await Promise.all(stakers.map(balanceOf));

    await openAs(page, wallet, organise(event.address, event.deployBlock, "payout"));
    await expect(page.getByTestId("payout-figures")).toBeVisible({ timeout: 30_000 });
    await shoot(page, "payout-open");
    await page.getByTestId("more").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await shoot(page, "payout-more");
    await page.getByRole("menuitem", { name: /Cancel the event/ }).click();
    await expect(page.getByRole("dialog").getByTestId("frozen")).toContainText("2");
    await confirmTyped(page, "Cancel the event");
    await expect(page.getByTestId("done")).toContainText("Event cancelled", { timeout: 30_000 });
    await expect(page.getByTestId("phase")).toHaveText("Cancelled", { timeout: 30_000 });

    const after = await Promise.all(stakers.map(balanceOf));
    after.forEach((balance, i) => expect(balance - before[i]!).toBe(10n ** 16n));
  });

  test("attendance then payout: locked before the start, posted after, released a day later", async ({
    page,
    wallet,
    hardhat,
  }) => {
    const event = await deployOrganiserEvent("Attendance Night", 3600);
    const [a, b, c] = await guestAccounts(3);
    const guests: LumaGuest[] = [];
    for (const w of [a!, b!, c!]) guests.push({ wallet: w, tx: await deposit(event.address, w) });
    await register(event.address, [a!, b!, c!]);

    await openAs(page, wallet, organise(event.address, event.deployBlock, "attendance"));
    await expect(page.getByTestId("locked")).toHaveText("Locked until the event starts.", { timeout: 30_000 });
    await shoot(page, "attendance-locked");

    await hardhat.increaseTime({ seconds: 3700 });
    await hardhat.mine({ blocks: 1 });
    await openAs(page, wallet, organise(event.address, event.deployBlock, "attendance"));
    await expect(page.getByTestId("phase")).toHaveText("Attendance due", { timeout: 30_000 });
    guests[0]!.checkedIn = true;
    guests[1]!.checkedIn = true;
    await page.getByTestId("checkin-csv").setInputFiles({
      name: "checkins.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lumaCsv(guests)),
    });
    await expect(page.getByTestId("attendance-figures")).toContainText("2 of 3 registered", { timeout: 30_000 });
    await shoot(page, "attendance");
    await page.getByRole("button", { name: "Post the list" }).click();
    await shoot(page, "attendance-confirm");
    await confirmTyped(page, "Post");
    await expect(page.getByTestId("posted")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByTestId("overview-phase")).toHaveText("List posted", { timeout: 30_000 });
    await shoot(page, "overview-listed");

    await page.getByRole("link", { name: "Payout", exact: true }).click();
    await expect(page.getByTestId("locked")).toContainText("challenge window is still open", { timeout: 30_000 });
    await shoot(page, "payout-locked");

    await hardhat.increaseTime({ seconds: DAY + 60 });
    await hardhat.mine({ blocks: 1 });
    const before = await Promise.all([a!, b!, c!].map(balanceOf));
    await openAs(page, wallet, organise(event.address, event.deployBlock, "payout"));
    const release = page.getByRole("button", { name: "Release payouts" });
    await expect(release).toBeEnabled({ timeout: 30_000 });
    await release.click();
    await shoot(page, "payout-confirm");
    await confirmTyped(page, "Release");
    await expect(page.getByTestId("done")).toHaveText("Payouts released.", { timeout: 30_000 });
    await expect(page.getByTestId("phase")).toHaveText(/Paid out/, { timeout: 30_000 });
    await shoot(page, "payout-released");

    const after = await Promise.all([a!, b!, c!].map(balanceOf));
    expect(after[0]! - before[0]!).toBe((3n * 10n ** 16n) / 2n);
    expect(after[1]! - before[1]!).toBe((3n * 10n ** 16n) / 2n);
    expect(after[2]).toBe(before[2]);
  });

  test("phone width: no route scrolls sideways at 375", async ({ page, wallet }) => {
    const { contract } = suiteEvent();
    await page.setViewportSize({ width: 375, height: 812 });
    const routes = [
      "/organise",
      "/organise/new",
      `/organise/${contract}?from=0`,
      `/organise/${contract}/guests?from=0`,
      `/organise/${contract}/attendance?from=0`,
      `/organise/${contract}/payout?from=0`,
    ];
    for (const route of routes) {
      await page.goto(route);
      await wallet.connect("alice");
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(1500);
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll, route).toBeLessThanOrEqual(client);
      if (route === `/organise/${contract}?from=0`) await shoot(page, "overview");
    }
  });
});
