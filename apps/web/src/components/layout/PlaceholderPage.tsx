import { ConnectWallet } from "@/components/wallet/ConnectWallet";

/** A route's heading and the connect button, until its screens come out of the design round. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="flex flex-col items-start gap-6">
      <h1 className="type-h1 text-klerosUIComponentsPrimaryText">{title}</h1>
      <ConnectWallet />
    </section>
  );
}
