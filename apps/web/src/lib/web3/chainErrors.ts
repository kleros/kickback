/** Walks viem's nested error causes. */
const chain = (error: unknown) => {
  const out: { code?: number; name?: string }[] = [];
  for (let e = error as { code?: number; name?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e)
    out.push(e);
  return out;
};

/** wallet_switchEthereumChain's "unknown chain" code, wherever viem nested it. */
export const isUnknownChain = (error: unknown): boolean => chain(error).some((e) => e.code === 4902);

/** The person declined in the wallet (EIP-1193 4001), wherever viem nested it. */
export const isRejected = (error: unknown): boolean =>
  chain(error).some((e) => e.code === 4001 || e.name === "UserRejectedRequestError");

/** A failed network switch, in plain words. */
export const switchErrorText = (error: unknown, chainName: string): string =>
  isRejected(error)
    ? "You declined the network switch in your wallet."
    : `Your wallet could not switch to ${chainName}. Switch the network in your wallet app, then try again.`;
