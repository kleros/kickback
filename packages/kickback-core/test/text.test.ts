import { describe, expect, it } from "vitest";

import { errorText, revertName } from "../src/errorText";
import { fmtEth, readableUnits } from "../src/text";

describe("readableUnits", () => {
  it("rounds to the nearest last digit, so a wei of dust does not change the digits", () => {
    expect(readableUnits(15999999999999999n, 18)).toBe("≈0.016");
    expect(readableUnits(49999999999999998n, 18)).toBe("≈0.05");
    expect(readableUnits(16666666666666666n, 18)).toBe("≈0.016667");
    expect(readableUnits(999999500000000000n, 18)).toBe("≈1");
  });
  it("keeps exact amounts exact and shows dust in full", () => {
    expect(readableUnits(11186000000000000n, 18)).toBe("0.011186");
    expect(readableUnits(10000000000000000n, 18)).toBe("0.01");
    expect(readableUnits(1n, 18)).toBe("0.000000000000000001");
  });
  it("leaves tokens with few decimals alone", () => {
    expect(readableUnits(1234567n, 6)).toBe("1.234567");
    expect(readableUnits(25n, 0)).toBe("25");
  });
  it("fmtEth follows the same rule", () => {
    expect(fmtEth(15999999999999999n)).toBe("≈0.016 ETH");
    expect(fmtEth(10n ** 16n)).toBe("0.01 ETH");
  });
});

describe("revert decoding through nested error data", () => {
  const TOO_LATE = "0xecdd1c29";
  it("finds Hardhat's {data:{message,data}} answer", () => {
    const e = {
      message: "Internal error",
      code: -32603,
      data: { message: "reverted with custom error 'TooLate()'", data: TOO_LATE },
    };
    expect(revertName(e)).toBe("TooLate");
    expect(errorText(e)).toBe("Too late: this window has closed.");
  });
  it("finds a viem-wrapped Hardhat answer (cause → data → data)", () => {
    const e = { shortMessage: "An internal error was received.", cause: { code: -32603, data: { data: TOO_LATE } } };
    expect(revertName(e)).toBe("TooLate");
  });
  it("finds MetaMask's {data:{code:3,data}} and {data:{originalError:{data}}}", () => {
    expect(revertName({ code: -32603, data: { code: 3, data: TOO_LATE } })).toBe("TooLate");
    expect(revertName({ code: -32603, data: { originalError: { data: TOO_LATE } } })).toBe("TooLate");
  });
});
