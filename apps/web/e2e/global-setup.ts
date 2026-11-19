import { FIRST_LOCAL_EVENT } from "@/config/protocol";

import { deploySuiteEvent } from "./utils/localEvent";
import { assertHardhatNode, assertKickbackApp } from "./utils/servers";

const rpc = async (url: string, method: string) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  }).catch(() => null);
  return response?.ok ? ((await response.json()) as { result?: string }).result : undefined;
};

/**
 * The node must be a Hardhat chain and the app this one, whichever process is answering on their ports.
 * Then the suite's event is deployed; specs read it from E2E_EVENT_* (workers inherit the environment).
 */
export default async function globalSetup() {
  const nodeUrl = process.env.NEXT_PUBLIC_LOCAL_RPC_URL!;
  const chainId = await rpc(nodeUrl, "eth_chainId");
  assertHardhatNode(nodeUrl, chainId === undefined ? undefined : Number(chainId));

  const appUrl = process.env.E2E_BASE_URL!;
  const page = await fetch(appUrl).catch(() => null);
  assertKickbackApp(appUrl, page?.ok ? await page.text() : undefined);

  const event = await deploySuiteEvent(nodeUrl);
  if (event.event !== FIRST_LOCAL_EVENT)
    throw new Error(`The suite's event deployed at ${event.event}, not ${FIRST_LOCAL_EVENT}: the node was not fresh.`);
  /* eslint-disable turbo/no-undeclared-env-vars -- read by the specs through e2e/utils/suiteEvent.ts */
  process.env.E2E_EVENT_CONTRACT = event.event;
  process.env.E2E_EVENT_START = String(event.eventStart);
  process.env.E2E_EVENT_CLAIM_DEADLINE = String(event.claimDeadline);
  /* eslint-enable turbo/no-undeclared-env-vars */
}
