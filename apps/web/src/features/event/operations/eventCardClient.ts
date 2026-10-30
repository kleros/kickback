import { createPublicClient, http, type Chain } from "viem";

export const EVENT_CARD_TIMEOUT_MS = 3_000;
export const EVENT_CARD_MAX_RESPONSE_BYTES = 128 * 1024;

export function createEventCardClient(chain: Chain) {
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0], {
      timeout: EVENT_CARD_TIMEOUT_MS,
      maxResponseBodySize: EVENT_CARD_MAX_RESPONSE_BYTES,
      retryCount: 0,
    }),
  });
}
