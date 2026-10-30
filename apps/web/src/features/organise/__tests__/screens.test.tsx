import type { ReactNode } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";

import { event, guest, plan } from "./fixtures";
import { AttendanceView } from "../components/AttendanceView";
import { CreateView } from "../components/CreateView";
import { GuestsView } from "../components/GuestsView";
import { ShellView } from "../components/OrganiserShell";
import { OverviewView, type OverviewData } from "../components/OverviewView";
import { ConfirmDialog } from "../components/parts";
import { PayoutView } from "../components/PayoutView";
import type { AttendanceScreenModel } from "../hooks/useAttendanceScreen";
import { formErrors, initialForm, type CreateScreenModel } from "../hooks/useCreateScreen";
import type { GuestsScreenModel } from "../hooks/useGuestsScreen";
import type { OrganiserEvent } from "../hooks/useOrganiserEvent";
import type { PayoutScreenModel } from "../hooks/usePayoutScreen";
import { overviewModel, type OverviewFacts } from "../model/phase";
import { gate } from "../model/shared";
import { caseView, challengeText, openAddress, openable, statusTone } from "../model/view";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/web3/send", () => ({ useSend: vi.fn(), useSendBusy: () => false }));
vi.mock("@/lib/web3/chain-time", () => ({ useChainTime: vi.fn() }));
vi.mock("@/components/wallet/ConnectWallet", () => ({
  ConnectWallet: ({ text }: { text: string }) => <button>{text}</button>,
}));

const facts = (patch: Partial<OverviewFacts> = {}): OverviewFacts => ({
  deposits: 5,
  registered: 3,
  attendees: 2,
  openChallenges: 0,
  challengeEndsAt: 0,
  spare: 0n,
  release: gate(),
  ...patch,
});
const overview = (phase: number, now: number, patch?: Partial<OverviewFacts>): OverviewData => ({
  ...overviewModel({ ...event, phase }, now, facts(patch)),
  verifiedKleros: true,
});
const locked = (reason: string) => gate(reason);
const cast = <T,>(value: unknown) => value as T;

describe("view helpers", () => {
  it("a gate blocked only by what the dialog asks for opens the dialog", () => {
    expect(openable(locked("Type PAY to release payouts."), "type PAY").enabled).toBe(true);
    expect(openable(locked("The challenge window is still open."), "type PAY")).toEqual(
      locked("The challenge window is still open."),
    );
  });

  it("counts challenges without handling them", () => {
    expect(challengeText(0)).toBe("None open");
    expect(challengeText(2)).toBe("2 open · handled in a later release");
  });

  it("opens only a contract address", () => {
    expect(openAddress("  ").error).toMatch(/Paste/);
    expect(openAddress("0x123").error).toMatch(/not a contract address/);
    expect(openAddress(` ${guest} `).address).toBe(guest);
  });

  it("reads the case as its question and paragraphs, and anything else whole", () => {
    expect(caseView(JSON.stringify({ question: "Did they attend?", description: "One.\n\nTwo." }))).toEqual([
      "Did they attend?",
      "One.",
      "Two.",
    ]);
    expect(caseView("plain")).toEqual(["plain"]);
  });

  it("tones a guest's status", () => {
    expect(statusTone("Registered")).toBe("ok");
    expect(statusTone("Less than the deposit; return it")).toBe("err");
    expect(statusTone("Refunded earlier; nothing to send.")).toBe("end");
    expect(statusTone("No transaction link on Luma")).toBe("warn");
  });

  it("names the field to fix in the create form", () => {
    const form = { ...initialForm(new Date("2027-01-01T10:00:00Z")), title: "Dinner" };
    const errors = formErrors(form);
    expect(errors.title).toBeUndefined();
    expect(errors.venue).toBe("Please fill this in.");
    expect(formErrors({ ...form, registrationLink: "luma.com/x" }).registrationLink).toBe(
      "Paste the full https:// link.",
    );
    expect(formErrors({ ...form, settleDays: "3" }).settleDays).toMatch(/7 to 365/);
  });
});

describe("overview", () => {
  it("deposits open: the phase in plain words and the guests step as the primary", () => {
    render(<OverviewView data={overview(0, 500)} court="Kleros Court" />);
    expect(screen.getByTestId("overview-phase")).toHaveTextContent("Deposits open");
    const action = screen.getByTestId("next-action");
    expect(action).toHaveClass("kb-btn");
    expect(action).not.toHaveClass("is-quiet");
    expect(action).toHaveAttribute("href", `/organise/${event.contract}/guests`);
    expect(screen.getByText("Verified Kleros Court contract")).toBeInTheDocument();
  });

  it("waiting for the event: a quiet link, with the reason posting is locked beside it", () => {
    render(<OverviewView data={overview(0, 500, { deposits: 3 })} court="Kleros Court" from={7} />);
    expect(screen.getByTestId("next-action")).toHaveClass("is-quiet");
    expect(screen.getByTestId("next-action")).toHaveAttribute("href", `/organise/${event.contract}/attendance?from=7`);
    expect(screen.getByTestId("locked")).toHaveTextContent(/Posting unlocks/);
  });

  it("list posted: attendees counted, open challenges counted for a later release", () => {
    render(
      <OverviewView
        data={overview(1, 2000, { openChallenges: 2, release: locked("The challenge window is still open.") })}
        court="Test court (Sepolia)"
      />,
    );
    expect(screen.getByTestId("overview-phase")).toHaveTextContent("List posted");
    expect(screen.getByTestId("counts")).toHaveTextContent("2 open · handled in a later release");
    expect(screen.getByTestId("locked")).toHaveTextContent("The challenge window is still open.");
  });

  it("past the deadline: no action, only the reason", () => {
    render(<OverviewView data={overview(0, event.claimDeadline + 1)} court="Kleros Court" />);
    expect(screen.queryByTestId("next-action")).toBeNull();
    expect(screen.getByTestId("locked")).toHaveTextContent("The deadline for posting attendance has passed.");
  });

  it("disconnected: the next step is not a second primary", () => {
    render(<OverviewView data={overview(0, 500)} court="Kleros Court" connected={false} />);
    expect(screen.getByTestId("next-action")).toHaveClass("is-quiet");
  });
});

describe("shell", () => {
  const shellEvent = (patch: Partial<OrganiserEvent["overview"]>, connected = true) =>
    cast<OrganiserEvent>({
      scope: { chainId: 1, address: event.contract, deployBlock: 9 },
      overview: { data: { ...overview(0, 500), event, cfg: {} }, isError: false, error: null, ...patch },
      isOwner: true,
      connected,
    });

  it("shows the phase and four tabs that keep the deploy block, the current one marked", () => {
    render(
      <ShellView
        address={event.contract}
        pathname={`/organise/${event.contract}/guests`}
        from="9"
        event={shellEvent({})}
      >
        <p>tab</p>
      </ShellView>,
    );
    expect(screen.getByTestId("phase")).toHaveTextContent("Deposits open");
    const nav = screen.getByRole("navigation", { name: "Organiser" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: "Guests" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Payout" })).toHaveAttribute(
      "href",
      `/organise/${event.contract}/payout?from=9`,
    );
    expect(screen.getByText("tab")).toBeInTheDocument();
    expect(screen.queryByText("Connect the organiser's wallet")).toBeNull();
  });

  it("an unreadable address says so in place of the tab, and asks for a wallet when none is connected", () => {
    render(
      <ShellView
        address={event.contract}
        pathname={`/organise/${event.contract}`}
        event={shellEvent({ data: undefined, isError: true, error: new Error("Not a Kickback contract.") }, false)}
      >
        <p>tab</p>
      </ShellView>,
    );
    expect(screen.getByTestId("read-error")).toHaveTextContent("Not a Kickback contract.");
    expect(screen.queryByText("tab")).toBeNull();
    expect(screen.getByText("Connect the organiser's wallet")).toBeInTheDocument();
  });
});

const guestRow = (patch: Record<string, unknown> = {}) => ({
  id: guest,
  name: "Guest",
  wallet: guest,
  tx: `0x${"ab".repeat(32)}`,
  amount: 10n ** 16n,
  held: 10n ** 16n,
  sentAt: "2026-10-30T10:00",
  explorer: null,
  status: "Deposit found; register the approved guest.",
  canRegister: gate(),
  canRefund: gate(),
  tick: "register" as "register" | "refund" | null,
  ...patch,
});
const guestsModel = (patch: Partial<GuestsScreenModel> = {}) =>
  cast<GuestsScreenModel>({
    rows: [guestRow()],
    total: 1,
    counts: { all: 1, register: 1, refund: 1, look: 0 },
    filter: "all",
    setFilter: vi.fn(),
    loading: false,
    readError: null,
    file: "luma.csv",
    csvLoaded: true,
    checking: false,
    loadCsv: vi.fn(),
    checkAgain: vi.fn(),
    setTick: vi.fn(),
    toRegister: 1,
    toRefund: 0,
    running: null,
    busy: false,
    error: null,
    done: null,
    register: vi.fn(),
    refund: vi.fn(),
    ...patch,
  });

describe("guests", () => {
  it("no deposits yet: an empty state, nothing to send", () => {
    render(<GuestsView model={guestsModel({ rows: [], total: 0, toRegister: 0 })} />);
    expect(screen.getByTestId("guests-empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register 0" })).toBeDisabled();
  });

  it("ticks are columns; a locked tick says why; the bar counts the selection and registers", async () => {
    const model = guestsModel({
      rows: [
        guestRow(),
        guestRow({
          id: "b",
          wallet: "0x4444444444444444444444444444444444444444",
          tick: null,
          canRegister: locked("Already registered."),
          status: "Registered",
        }),
      ],
      total: 2,
    });
    render(<GuestsView model={model} />);
    const rows = screen.getAllByTestId("guest-row");
    expect(within(rows[0]!).getByRole("checkbox", { name: /^Register/ })).toBeChecked();
    const lockedTick = within(rows[1]!).getByRole("checkbox", { name: /^Register/ });
    expect(lockedTick).toBeDisabled();
    expect(lockedTick.closest("label")).toHaveAttribute("title", "Already registered.");
    expect(screen.getByTestId("selection")).toHaveTextContent("1 selected · 2 deposits");
    await userEvent.click(within(rows[0]!).getByRole("checkbox", { name: /^Refund/ }));
    expect(model.setTick).toHaveBeenCalledWith(guest, "refund");
    await userEvent.click(screen.getByRole("button", { name: "Register 1" }));
    expect(model.register).toHaveBeenCalledOnce();
  });

  it("while a batch runs every tick and button is locked; a refusal names the fix", () => {
    render(
      <GuestsView
        model={guestsModel({
          running: "register",
          error: { text: "Not sent. The contract changed since the check; check the list again.", at: 1 },
        })}
      />,
    );
    expect(screen.getAllByRole("checkbox").every((box) => (box as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByTestId("error")).toHaveTextContent("The contract changed since the check");
  });

  it("a finished batch says what was done", () => {
    render(<GuestsView model={guestsModel({ done: "Registered 1." })} />);
    expect(screen.getByTestId("done")).toHaveTextContent("Registered 1.");
  });
});

const attendanceModel = (patch: Partial<AttendanceScreenModel> = {}) =>
  cast<AttendanceScreenModel>({
    correction: {
      wallets: "",
      setWallets: vi.fn(),
      open: false,
      gate: gate(),
      pending: false,
      done: false,
      show: vi.fn(),
      close: vi.fn(),
      confirm: vi.fn(),
    },
    checkin: null,
    door: null,
    loadCheckin: vi.fn(),
    loadDoor: vi.fn(),
    building: false,
    buildError: null,
    figures: null,
    downloads: null,
    post: locked("Locked until the event starts."),
    frozen: null,
    open: vi.fn(),
    close: vi.fn(),
    confirm: vi.fn(),
    posting: false,
    posted: false,
    busy: false,
    error: null,
    ...patch,
  });

describe("attendance", () => {
  it("before the start: posting is locked with the reason beside it", () => {
    render(<AttendanceView model={attendanceModel()} posted={false} />);
    expect(screen.getByRole("button", { name: "Post the list" })).toBeDisabled();
    expect(screen.getByTestId("locked")).toHaveTextContent("Locked until the event starts.");
  });

  it("a built list shows its figures and downloads, and opens the confirm", async () => {
    const model = attendanceModel({
      checkin: { name: "checkins.csv", text: "", rows: 3 },
      figures: { attendees: 2, registered: 3, noShows: 1, unmatched: 0, share: 15n * 10n ** 15n },
      downloads: { csv: "a", summary: "b", plan: "c" },
      post: gate(),
    });
    render(<AttendanceView model={model} posted={false} />);
    expect(screen.getByTestId("attendance-figures")).toHaveTextContent("2 of 3 registered");
    expect(screen.getByTestId("attendance-figures")).toHaveTextContent("0.015 ETH");
    expect(screen.getByRole("link", { name: /payout\.csv/ })).toHaveAttribute("download", "payout.csv");
    await userEvent.click(screen.getByRole("button", { name: "Post the list" }));
    expect(model.open).toHaveBeenCalledOnce();
  });

  it("the confirm shows the frozen figures and asks NOSHOW then POST when stakers are unmatched", async () => {
    const model = attendanceModel({
      frozen: { plan, attendees: 1, registered: 2, noShows: 1, unmatched: 1, share: 20n },
      post: gate(),
    });
    render(<AttendanceView model={model} posted={false} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("frozen")).toHaveTextContent("1 of 2");
    const post = within(dialog).getByRole("button", { name: "Post" });
    await userEvent.type(within(dialog).getByLabelText("Type NOSHOW to confirm"), "NOSHOW");
    expect(post).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Type POST to confirm"), "POST");
    await userEvent.click(post);
    expect(model.confirm).toHaveBeenCalledWith("POST", "NOSHOW");
  });

  it("posted: says so and offers no second post", () => {
    render(<AttendanceView model={attendanceModel()} posted />);
    expect(screen.getByTestId("posted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post the list" })).toBeNull();
  });
});

describe("typed confirm", () => {
  it("cannot be dismissed while busy", () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        busy
        title="Release payouts"
        intro="Frozen."
        figures={[{ label: "Pool", value: "1 ETH" }]}
        words={["PAY"]}
        action="Release"
        error={null}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByLabelText("Type PAY to confirm")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
  });
});

const payoutModel = (patch: Partial<PayoutScreenModel> = {}) =>
  cast<PayoutScreenModel>({
    loading: false,
    readError: null,
    figures: {
      pool: 3n * 10n ** 16n,
      attendees: 2,
      share: 15n * 10n ** 15n,
      heldBack: 0n,
      spare: 0n,
      openChallenges: 1,
      registered: 3,
    },
    gates: {
      release: locked("The challenge window is still open."),
      sweep: locked("Collect leftovers after payouts or cancellation."),
      cancel: locked("Cancel only before the attendance list is posted."),
      refund: gate(),
      returnToken: gate(),
      removeGuest: locked("Remove a guest only before the list is posted."),
    },
    frozen: null,
    fields: { to: "", amount: "", guest: "", token: "" },
    setField: vi.fn(),
    dialogGate: null,
    open: vi.fn(),
    close: vi.fn(),
    confirm: vi.fn(),
    pending: false,
    busy: false,
    error: null,
    done: null,
    ...patch,
  });

describe("payout", () => {
  it("during the window: release locked with its reason; challenges only counted", () => {
    render(<PayoutView model={payoutModel()} released={false} />);
    expect(screen.getByRole("button", { name: "Release payouts" })).toBeDisabled();
    expect(screen.getByTestId("locked")).toHaveTextContent("The challenge window is still open.");
    expect(screen.getByTestId("payout-figures")).toHaveTextContent("1 open · handled in a later release");
  });

  it("the rare actions sit under one More menu, locked ones saying why", async () => {
    const model = payoutModel();
    render(<PayoutView model={model} released={false} />);
    await userEvent.click(screen.getByTestId("more"));
    const menu = screen.getByRole("menu");
    const cancel = within(menu).getByRole("menuitem", { name: /Cancel the event/ });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).toHaveTextContent("Cancel only before the attendance list is posted.");
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Return stray ETH/ }));
    expect(model.open).toHaveBeenCalledWith("refund");
  });

  it("the release confirm shows the frozen figures and sends only after PAY", async () => {
    const model = payoutModel({
      frozen: { action: "release", pool: 3n * 10n ** 16n, attendees: 2, share: 15n * 10n ** 15n, heldBack: 0n },
    });
    render(<PayoutView model={model} released={false} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("frozen")).toHaveTextContent("0.03 ETH");
    await userEvent.type(within(dialog).getByLabelText("Type PAY to confirm"), "PAY");
    await userEvent.click(within(dialog).getByRole("button", { name: "Release" }));
    expect(model.confirm).toHaveBeenCalledWith("PAY");
  });

  it("released: no release button, and the result is said", () => {
    render(<PayoutView model={payoutModel({ done: "Payouts released." })} released />);
    expect(screen.queryByRole("button", { name: "Release payouts" })).toBeNull();
    expect(screen.getByTestId("done")).toHaveTextContent("Payouts released.");
  });
});

const createModel = (patch: Partial<CreateScreenModel> = {}) =>
  cast<CreateScreenModel>({
    form: initialForm(new Date("2027-01-01T10:00:00Z")),
    setField: vi.fn(),
    errors: {},
    preview: null,
    policyURI: "/ipfs/QmPzb9q9TyHS2jPmoCd1U9eDfZ9Nijh5NSFhhvJGVU7knE",
    policyPinned: false,
    deployGate: gate(),
    notSetUp: null,
    step: "form",
    busy: false,
    deploy: vi.fn(),
    askNew: false,
    closeNew: vi.fn(),
    confirmNew: vi.fn(),
    newWord: "NEW",
    deployed: null,
    previous: [],
    error: null,
    ...patch,
  });

describe("create", () => {
  it("the form with the jurors' preview beside it, and Deploy", async () => {
    const model = createModel({
      preview: JSON.stringify({ question: "Did the guest attend Dinner?", description: "About one guest." }),
    });
    render(<CreateView model={model} />);
    expect(screen.getByTestId("case-text")).toHaveTextContent("Did the guest attend Dinner?");
    await userEvent.type(screen.getByLabelText("Title"), "D");
    expect(model.setField).toHaveBeenCalledWith("title", expect.stringContaining("D"));
    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(model.deploy).toHaveBeenCalledOnce();
  });

  it("invalid fields are marked and Deploy says why it is locked", () => {
    render(
      <CreateView
        model={createModel({
          errors: { venue: "Please fill this in." },
          deployGate: locked("Fix the fields marked above."),
        })}
      />,
    );
    expect(screen.getByLabelText("Venue")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
    expect(screen.getByTestId("locked")).toHaveTextContent("Fix the fields marked above.");
  });

  it("Sepolia not set up: says so and refuses", () => {
    const reason = "Sepolia is not set up yet: its test court contracts are not deployed. Nothing can be created here.";
    render(<CreateView model={createModel({ notSetUp: reason, deployGate: locked(reason) })} />);
    expect(screen.getByTestId("not-set-up")).toHaveTextContent("Sepolia is not set up yet");
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });

  it("deploying: the label says what the wallet is waiting on", () => {
    render(<CreateView model={createModel({ step: "deploying" })} />);
    expect(screen.getByRole("button", { name: /Deploying/ })).toBeInTheDocument();
  });

  it("deployed: the links to share, the Luma setup list and the events from this browser", () => {
    const address: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    render(
      <CreateView
        model={createModel({
          deployed: {
            address,
            block: 12,
            adminLink: `http://x/organise/${address}?from=12`,
            guestLink: `http://x/event/${address}?from=12`,
          },
          previous: [{ address, chainId: 31337, block: 12, name: "Dinner" }],
        })}
      />,
    );
    expect(screen.getByTestId("guest-link")).toHaveTextContent(`/event/${address}?from=12`);
    expect(screen.getByTestId("open-event")).toHaveAttribute("href", `/organise/${address}?from=12`);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("wallet address"), expect.stringContaining("Dinner")]),
    );
    expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
  });

  it("a second event from this browser asks for NEW", async () => {
    const model = createModel({ askNew: true });
    render(<CreateView model={model} />);
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Type NEW to confirm"), "NEW");
    await userEvent.click(within(dialog).getByRole("button", { name: "Deploy" }));
    expect(model.confirmNew).toHaveBeenCalledWith("NEW");
  });
});

it("offers corrections after posting and opens their confirmation", async () => {
  const model = attendanceModel();
  render(<AttendanceView model={model} posted />);
  await userEvent.type(screen.getByLabelText("Registered wallets to add"), guest);
  expect(model.correction.setWallets).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Add attendees" }));
  expect(model.correction.show).toHaveBeenCalledOnce();
});

it("locks corrections when the challenge window closes", () => {
  const model = attendanceModel();
  model.correction.gate = locked("The challenge window has closed; the list cannot be changed.");
  render(<AttendanceView model={model} posted />);
  expect(screen.getByRole("button", { name: "Add attendees" })).toBeDisabled();
  expect(screen.getByText(/window has closed/)).toBeVisible();
});

it("opens Return tokens from More and shows token-specific inputs", async () => {
  const model = payoutModel();
  const view = render(<PayoutView model={model} released />);
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Return tokens/ }));
  expect(model.open).toHaveBeenCalledWith("returnToken");
  view.rerender(
    <PayoutView
      released
      model={payoutModel({
        frozen: { action: "returnToken" },
        token: { balance: 1000000n, decimals: 6, symbol: "USDC" },
        dialogGate: locked("Enter an amount to return."),
      })}
    />,
  );
  expect(screen.getByLabelText("Token contract")).toBeVisible();
  expect(screen.getByLabelText("To wallet")).toBeVisible();
  expect(screen.getByLabelText("Amount, smallest token units")).toBeVisible();
  expect(screen.getByRole("dialog")).toHaveTextContent("1000000");
});

it("wires description, cover and links inputs and shows the guest preview", async () => {
  const model = createModel({
    setCover: vi.fn(),
    form: { ...initialForm(), title: "Dinner", description: "Meet friends", links: "Website | https://example.com" },
    coverUrl: "blob:chosen-cover",
    detailLinks: [{ label: "Website", url: "https://example.com" }],
  });
  render(<CreateView model={model} />);
  await userEvent.type(screen.getByLabelText("Description"), "!");
  expect(model.setField).toHaveBeenCalledWith("description", "Meet friends!");
  await userEvent.type(screen.getByRole("textbox", { name: "Extra links" }), "x");
  expect(model.setField).toHaveBeenCalledWith("links", expect.stringContaining("example.com"));
  const file = new File(["image"], "cover.png", { type: "image/png" });
  await userEvent.upload(screen.getByLabelText("Cover image"), file);
  expect(model.setCover).toHaveBeenCalledWith(file);
  const preview = screen.getByLabelText("Guest page preview");
  expect(preview).toHaveTextContent("Meet friends");
  expect(within(preview).getByRole("link")).toHaveTextContent("example.com");
  expect(preview.querySelector("img")).toHaveAttribute("src", "blob:chosen-cover");
});

it("converts create details into the pinning form and rejects too many links", async () => {
  const { createFormInput } = await import("../hooks/useCreateScreen");
  const { form } = await import("./fixtures");
  const file = new File(["image"], "cover.png", { type: "image/png" });
  const values = { ...form, settleDays: "14", description: "Details", links: "Site | https://example.com" };
  expect(createFormInput(values, file)).toMatchObject({
    description: "Details",
    cover: file,
    links: [{ label: "Site", url: "https://example.com" }],
  });
  expect(formErrors({ ...values, links: Array(4).fill(values.links).join("\n") }).links).toBeTruthy();
});

it("labels both guest and disconnected organiser preview wallets as examples", () => {
  render(<CreateView model={createModel({ preview: "Example case" })} />);
  expect(screen.getByTestId("jurors-preview")).toHaveTextContent("Guest: example wallet.");
  expect(screen.getByTestId("jurors-preview")).toHaveTextContent(
    "When disconnected, the organiser is also an example wallet.",
  );
});
