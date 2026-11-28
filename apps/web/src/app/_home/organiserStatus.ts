import type { RowStatus } from "@/features/event";
import { PHASE_TONE, phaseLabel, phaseOf } from "@/features/organise";

// each row opens the organiser page: its pill follows that page's phase pill. The row does not read each
// challenge, so a late challenge counts as waiting until its latest possible answer time: the pill may show
// "Challenges pending" a little longer than the organiser page, never "Payouts ready" too early
export const organiserStatus: RowStatus = (event, now) => {
  const mayWait =
    event.phase === 1 &&
    event.waitingChallenges > 0 &&
    now > event.challengeEndsAt &&
    now <= event.challengeEndsAt + event.matchPeriod;
  const phase = phaseOf(event, now, mayWait ? 1 : 0, event.heldAtEnd);
  return { text: phaseLabel(phase, event), tone: PHASE_TONE[phase] };
};
