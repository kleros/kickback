import { writeFile } from "node:fs/promises";

import { type Page } from "@playwright/test";
import { formatEther, type Address } from "viem";

import { MOCK_ACCOUNTS } from "@/lib/web3/mock-account";

import { expect, test } from "../fixtures";
import { pageWords } from "../utils/pageWords";

/**
 * The whole life of one event, through the pages only: an organiser creates it, guests book,
 * one is turned away, the Luma check-in export picks who came, a no-show challenges, and the
 * payout splits the pool. Runs last (its own project): it moves the node's clock for good.
 */

// Hardhat's unlocked accounts #2..#5, as guests besides bob
const CAROL: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const DAVE: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const ERIN: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const FRANK: Address = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const BOB = MOCK_ACCOUNTS.bob;
const ALICE = MOCK_ACCOUNTS.alice;

const DEPOSIT = 10n ** 16n; // 0.01 ETH

const local = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 16); // GMT, as the config's timezoneId

async function shot(page: Page, name: string) {
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- optional, for reviewing the run by eye
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  // the page as a phone and a laptop see it, once it has settled
  const size = page.viewportSize();
  await page.waitForTimeout(400);
  await writeFile(`${dir}/${name}.txt`, await pageWords(page));
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

test("organiser creates, guests book, Luma check-ins pick who came, a challenge, payouts", async ({
  page,
  wallet,
  time,
  hardhat,
}) => {
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- optional, for reviewing the run by eye
  const shots = !!process.env.E2E_SHOTS_DIR;
  test.setTimeout(shots ? 600_000 : 240_000);
  if (shots) await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await time.install();
  const now = await time.getHardhatTime();
  const start = now + 3600;
  const end = now + 2 * 3600;

  // 0. a newcomer lands on the home page and the organise page
  await page.goto("/");
  await shot(page, "00a-home");
  await page.goto("/organise");
  await shot(page, "00b-organise-disconnected");

  // 1. the organiser creates the event; it gets its own contract and organiser page
  await page.goto("/organise/new");
  await shot(page, "00c-create-disconnected");
  await wallet.connect("alice");
  await shot(page, "00d-create-empty");
  await page.getByLabel("Event name").fill("Proof of Presence test");
  await page.getByLabel("Event page").fill("https://luma.com/eprlj5e3");
  await page.getByLabel(/^Deposit, ETH/).fill("0.01");
  await page.getByLabel("Starts").fill(local(start));
  await page.getByLabel("Ends").fill(local(end));
  await shot(page, "01-create");
  await page.getByRole("button", { name: "Create the event" }).click();
  await page.waitForURL(/\/organise\/0x[0-9a-fA-F]{40}$/, { timeout: 60_000 });
  const contract = page.url().split("/").pop() as Address;
  await expect(page.getByTestId("event-name")).toHaveText("Proof of Presence test");
  await shot(page, "02-organiser-overview");
  await page.goto("/organise");
  await shot(page, "02b-organise-your-events");
  await page.goto(`/event/${contract}`);
  await shot(page, "02c-guest-page-disconnected");

  // 2. five guests book on the guest page
  for (const guest of [BOB, CAROL, DAVE, ERIN, FRANK]) {
    await page.goto(`/event/${contract}`);
    await wallet.connect(guest);
    const ticket = page.getByTestId("ticket");
    if (guest === BOB) await shot(page, "02d-guest-page-connected");
    await ticket.getByRole("button", { name: /deposit/i }).click();
    await expect(page.getByTestId("receipt-tx")).toBeVisible({ timeout: 60_000 });
  }
  await shot(page, "03-guest-booked");
  await page.goto(`/organise/${contract}/guests`);
  await wallet.connect("alice");
  await expect(page.getByTestId("guest-row")).toHaveCount(5);
  await page.getByTestId("guest-check-input").fill(CAROL);
  await page.getByTestId("luma-csv").setInputFiles({
    name: "luma-pending.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "api_id,name,email,ticket_name,eth_address,approval_status",
        `p1,Bob,bob@example.com,Deposited,${BOB},pending_approval`,
        `p2,Carol,carol@example.com,Deposited,${CAROL},approved`,
        "p3,Faker,faker@example.com,Deposited,0x000000000000000000000000000000000000bEEF,pending_approval",
        "p4,Free guest,free@example.com,Free,,pending_approval",
      ].join("\n"),
    ),
  });
  await expect(page.getByTestId("luma-row")).toHaveCount(4);
  await shot(page, "03b-organiser-guests-luma-match");
  expect(await hardhat.getBalance({ address: contract })).toBe(5n * DEPOSIT);

  // 3. the organiser turns erin away: her deposit comes back in full
  await page.goto(`/organise/${contract}/guests`);
  await wallet.connect("alice");
  const erinBefore = await hardhat.getBalance({ address: ERIN });
  await page.getByLabel(`Turn away ${ERIN}`).check();
  await page
    .getByRole("button", { name: /turn away/i })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /turn away/i })
    .click();
  await expect(page.locator(`[data-wallet="${ERIN.toLowerCase()}"]`)).toContainText(/turned away|refunded/i, {
    timeout: 60_000,
  });
  expect(await hardhat.getBalance({ address: ERIN })).toBe(erinBefore + DEPOSIT);
  await shot(page, "04-turned-away");

  // 3b. during the event, a walk-in books and sees the receipt
  await time.setTime(start + 600);
  await page.goto(`/organise/${contract}`);
  await shot(page, "04b-organiser-overview-during");

  // 4. the event ends; the Luma export says bob and carol checked in (dave and frank did not, one walk-in has no deposit)
  await time.setTime(end + 60);
  const csv = [
    "api_id,name,email,eth_address,checked_in_at,approval_status",
    `g1,Bob,bob@example.com,${BOB},2026-11-19T09:10:00.000Z,approved`,
    `g2,Carol,carol@example.com,${CAROL},2026-11-19T09:12:00.000Z,approved`,
    `g3,Dave,dave@example.com,${DAVE},,approved`,
    `g4,Frank,frank@example.com,${FRANK},,approved`,
    `g5,Walk-in,walkin@example.com,0x000000000000000000000000000000000000dEaD,2026-11-19T09:20:00.000Z,approved`,
  ].join("\n");
  await page.goto(`/event/${contract}`);
  await wallet.connect(BOB);
  await shot(page, "04c-guest-after-end-booked");
  await wallet.connect("alice");
  await shot(page, "04d-guest-after-end-other-wallet");
  await page.goto(`/organise/${contract}`);
  await shot(page, "04e-organiser-overview-after-end");
  await page.goto(`/organise/${contract}/attendance`);
  await wallet.connect("alice");
  await shot(page, "04f-attendance-empty");
  await page.getByTestId("checkin-csv").setInputFiles({
    name: "luma-guests.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText(/3 rows not used/)).toBeVisible();
  await shot(page, "05-attendance-from-luma");
  await page
    .getByRole("button", { name: /confirm and close/i })
    .first()
    .click();
  const confirm = page.getByRole("dialog");
  await confirm.getByLabel(/Type POST/).fill("POST");
  await confirm.getByRole("button", { name: /confirm and close/i }).click();
  await expect(page.getByText(/challenge window is open/i)).toBeVisible({ timeout: 60_000 });
  await shot(page, "06-list-posted");
  await page.goto(`/organise/${contract}`);
  await shot(page, "06b-organiser-overview-challenge-window");
  await page.goto(`/event/${contract}`);
  await wallet.connect(BOB);
  await shot(page, "06c-guest-on-list");
  await wallet.connect(DAVE);
  await shot(page, "06d-guest-not-on-list");

  // 5. dave says he came: he challenges the list from his guest page
  await page.goto(`/event/${contract}`);
  await wallet.connect(DAVE);
  await page.getByTestId("ticket").getByRole("button", { name: "Challenge the list" }).click();
  await expect(page.getByTestId("ticket-status")).toContainText(/challenge sent/i, { timeout: 60_000 });
  await shot(page, "07-challenge-sent");
  await page.goto(`/organise/${contract}/payout`);
  await wallet.connect("alice");
  await shot(page, "07b-organiser-payout-with-challenge");

  // 6. the organiser leaves it unanswered; after the window it counts as accepted, and payouts are released
  await time.advanceTime(2 * 24 * 3600);
  await page.goto(`/organise/${contract}/payout`);
  await wallet.connect("alice");
  await expect(page.getByTestId("challenge-row")).toHaveCount(1);
  await shot(page, "07c-organiser-payout-ready");
  await page.getByRole("button", { name: "Release payouts" }).first().click();
  const pay = page.getByRole("dialog");
  await pay.getByLabel(/Type PAY/).fill("PAY");
  await pay.getByRole("button", { name: "Release payouts" }).click();
  await expect(page.getByText(/payouts released/i)).toBeVisible({ timeout: 60_000 });
  await shot(page, "08-payouts-released");

  // 7. bob, carol and dave share the 0.04 ETH pool (frank no-show); each claims on the guest page
  const share = (4n * DEPOSIT) / 3n;
  for (const guest of [BOB, CAROL, DAVE]) {
    const before = await hardhat.getBalance({ address: guest });
    await page.goto(`/event/${contract}`);
    await wallet.connect(guest);
    if (guest === BOB) await shot(page, "08b-guest-ready-to-claim");
    await page
      .getByTestId("ticket")
      .getByRole("button", { name: /claim|withdraw/i })
      .click();
    await expect(page.getByTestId("ticket-status")).toContainText(/paid|claimed|sent|returned/i, {
      timeout: 60_000,
    });
    const gained = (await hardhat.getBalance({ address: guest })) - before;
    // a share, give or take gas (and dave's challenge deposit back)
    expect(Number(formatEther(gained))).toBeGreaterThan(Number(formatEther(share)) - 0.001);
  }
  await shot(page, "09-guest-paid");
  await page.goto(`/event/${contract}`);
  await wallet.connect(FRANK);
  await shot(page, "09b-guest-no-show");
  await page.goto(`/organise/${contract}`);
  await wallet.connect("alice");
  await shot(page, "09c-organiser-overview-paid");
  expect(await hardhat.getBalance({ address: contract })).toBeLessThan(10n); // dust at most
  void ALICE;
});
