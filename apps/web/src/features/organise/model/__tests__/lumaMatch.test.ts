import { describe, expect, it } from "vitest";

import { matchLuma } from "../lumaMatch";

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

  it("flags a second registration with the same wallet: one deposit, one ticket", () => {
    const csv = ["name,email,eth_address", `Al,al@x.io,${A}`, `Al again,al2@x.io,${A.toLowerCase()}`].join("\n");
    const rows = matchLuma(csv, [A]);
    expect(rows.map((r) => [r.name, r.dupOf])).toEqual([
      ["Al", undefined],
      ["Al again", "Al"],
    ]);
  });
});
