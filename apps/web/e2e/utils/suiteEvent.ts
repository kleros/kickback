import type { Address } from "viem";

/** The event global-setup deployed, read from the environment it set. */
export function suiteEvent() {
  /* eslint-disable turbo/no-undeclared-env-vars -- set by e2e/global-setup.ts, never through a turbo task */
  const contract = process.env.E2E_EVENT_CONTRACT as Address | undefined;
  const eventStart = Number(process.env.E2E_EVENT_START);
  const claimDeadline = Number(process.env.E2E_EVENT_CLAIM_DEADLINE);
  /* eslint-enable turbo/no-undeclared-env-vars */
  if (!contract) throw new Error("E2E_EVENT_CONTRACT is unset: run the specs through playwright.config.ts.");
  return { contract, eventStart, claimDeadline };
}
