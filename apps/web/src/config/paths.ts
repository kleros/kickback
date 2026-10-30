/**
 * Every route the app links to, in one place. Components call `getHref()`
 * instead of writing URL strings, so a moved route is a single edit here.
 */
export const HOW_IT_WORKS_ID = "how-it-works";

export const paths = {
  home: {
    getHref: () => "/",
  },
  event: {
    /** No contract: the live event, by redirect. `from` is the block deposits are read from. */
    getHref: (contract?: string, from?: string | number) =>
      contract
        ? `/event/${contract}${from === undefined ? "" : `?from=${encodeURIComponent(String(from))}`}`
        : "/event",
  },
  howItWorks: {
    getHref: (contract: string) => `/event/${contract}#${HOW_IT_WORKS_ID}`,
  },
  organise: {
    getHref: () => "/organise",
  },
  organiseNew: {
    getHref: () => "/organise/new",
  },
  organiseEvent: {
    /** An organiser tab; `from` is the event's deploy block, so the tab need not search for it. */
    getHref: (contract: string, from?: string | number, tab?: "guests" | "attendance" | "payout") =>
      `/organise/${contract}${tab ? `/${tab}` : ""}${from === undefined ? "" : `?from=${encodeURIComponent(String(from))}`}`,
  },
} as const;
