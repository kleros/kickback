import { describe, expect, it } from "vitest";

import { hasWalletColumn, matchLuma } from "../lumaMatch";

const A = "0x02459459716683608130dca53f9E0Bf471C0B59C";
const B = "0x259a1084C2043a7B3b5b288596E05C41b8EFa5d6";

describe("matchLuma", () => {
  it("marks Luma registrations whose verified wallet deposited, matches first", () => {
    const csv = [
      "name,email,ticket_name,approval_status,eth_address",
      `Bo,bo@x.io,Deposited,pending_approval,${B}`,
      `Al,al@x.io,Deposited,pending_approval,${A.toLowerCase()}`,
      "Cy,cy@x.io,Free,approved,",
    ].join("\n");
    const rows = matchLuma(csv, [A]);
    expect(rows.map((r) => [r.name, r.match, r.luma])).toEqual([
      ["Al", "deposit", "pending"],
      ["Bo", "none", "pending"],
      ["Cy", "no-wallet", "approved"],
    ]);
  });

  it("tells a turned-away or refunded wallet apart from one that never deposited", () => {
    const C = "0x00000000000000000000000000000000000000cC";
    const csv = [
      "name,email,approval_status,eth_address",
      `Bo,bo@x.io,pending_approval,${B}`,
      `Cy,cy@x.io,approved,${C}`,
      `Al,al@x.io,approved,${A}`,
    ].join("\n");
    const statuses = new Map([
      [B.toLowerCase(), 2],
      [C.toLowerCase(), 3],
    ]);
    expect(matchLuma(csv, [A], statuses).map((r) => [r.name, r.match])).toEqual([
      ["Al", "deposit"],
      ["Bo", "turned-away"],
      ["Cy", "refunded"],
    ]);
    // the Attendance tab passes no statuses: those wallets are simply not booked
    expect(matchLuma(csv, [A]).map((r) => r.match)).toEqual(["deposit", "none", "none"]);
  });

  it("flags a second registration with the same wallet: one deposit, one ticket", () => {
    const csv = ["name,email,eth_address", `Al,al@x.io,${A}`, `Al again,al2@x.io,${A.toLowerCase()}`].join("\n");
    const rows = matchLuma(csv, [A]);
    expect(rows.map((r) => [r.name, r.dupOf])).toEqual([
      ["Al", undefined],
      ["Al again", "Al"],
    ]);
  });

  it("keeps the request already approved on Luma as the main one, whatever the CSV order", () => {
    const csv = [
      "name,email,approval_status,eth_address",
      `Al again,al2@x.io,pending_approval,${A}`,
      `Al,al@x.io,approved,${A.toLowerCase()}`,
    ].join("\n");
    const rows = matchLuma(csv, [A]);
    expect(rows.find((r) => r.name === "Al")?.dupOf).toBeUndefined();
    expect(rows.find((r) => r.name === "Al again")?.dupOf).toBe("Al");
  });

  it("never takes a wallet from a free-text answer when the export has no wallet column", () => {
    const csv = ["name,email,answer", `Al,al@x.io,my wallet is ${A}`].join("\n");
    expect(matchLuma(csv, [A]).map((r) => r.match)).toEqual(["no-wallet"]);
    expect(hasWalletColumn(csv)).toBe(false);
    expect(hasWalletColumn(`name,eth_address\nAl,${A}`)).toBe(true);
  });

  it("counts only Luma's verified eth_address column, not a custom question about wallets", () => {
    const csv = ["name,email,Your wallet address", `Al,al@x.io,${A}`].join("\n");
    expect(matchLuma(csv, [A]).map((r) => r.match)).toEqual(["no-wallet"]);
    expect(hasWalletColumn(csv)).toBe(false);
  });
});
