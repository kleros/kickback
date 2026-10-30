import { ChainClock } from "@/components/ChainClock";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

/** A route's heading and the connect button, until its screens are built. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="kb-narrow flex flex-col items-start gap-6">
      <h1 className="kb-h1">{title}</h1>
      <ConnectWallet />
      <ChainClock />
    </section>
  );
}
