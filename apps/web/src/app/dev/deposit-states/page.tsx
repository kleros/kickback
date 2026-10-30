import { notFound } from "next/navigation";

import { DepositStatesGallery } from "@/features/event";

import { isMockWalletEnabled } from "@/lib/web3/mock-account";

/** Every deposit state from fixtures. Compiled out of production builds with the mock wallet. */
export default function DepositStatesPage({ searchParams }: { searchParams: { state?: string } }) {
  if (!isMockWalletEnabled) notFound();
  return <DepositStatesGallery state={searchParams.state} />;
}
