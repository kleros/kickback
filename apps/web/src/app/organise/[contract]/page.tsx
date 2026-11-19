import { OverviewScreen } from "@/features/organise";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { courtName } from "@/config/protocol";

export default function OverviewPage() {
  return <OverviewScreen court={courtName(DEFAULT_CHAIN_ID)} />;
}
