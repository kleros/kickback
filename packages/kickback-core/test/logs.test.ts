import { describe, expect, it } from "vitest";

import { getLogsChunked } from "../src";

describe("getLogsChunked", () => {
  it("reads every chunk by default", async () => {
    const asked: bigint[] = [];
    const logs = await getLogsChunked(
      { getLogs: async ({ fromBlock }) => (asked.push(fromBlock), [fromBlock]) },
      0,
      29,
      10,
    );
    expect(logs).toEqual([0n, 10n, 20n]);
    expect(asked).toEqual([0n, 10n, 20n]);
  });

  it("stops after the chunk where stopWhen first holds", async () => {
    const asked: bigint[] = [];
    const logs = await getLogsChunked(
      {
        getLogs: async ({ fromBlock }) => {
          asked.push(fromBlock);
          return fromBlock === 10n ? ["created"] : [];
        },
      },
      0,
      49,
      10,
      { stopWhen: (found) => found.length > 0 },
    );
    expect(logs).toEqual(["created"]);
    expect(asked).toEqual([0n, 10n]);
  });
});
