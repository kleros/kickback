"use client";

import { useCallback, useEffect, useState } from "react";

import { addNames, markChecked, readChecked, readNames, type CheckedBook, type LumaBook } from "../model/lumaBook";

/**
 * The organiser's local Luma names and door checks for one event, shared by the tabs. Names belong to the organiser
 * wallet that loaded them (`owner`, the connected wallet while it is the event's organiser) and are read only while
 * `enabled`; door checks are kept per event and always count, so no one is approved twice.
 */
export function useLumaBook(contract: string, owner: string | undefined, enabled: boolean) {
  const [names, setNames] = useState<LumaBook>({});
  const [checked, setChecked] = useState<CheckedBook>({});
  useEffect(() => {
    const load = () => {
      setNames(owner && enabled ? readNames(contract, owner) : {});
      setChecked(readChecked(contract));
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener("kb-luma", load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener("kb-luma", load);
    };
  }, [contract, owner, enabled]);
  const add = useCallback(
    (rows: Parameters<typeof addNames>[2]) => {
      if (!enabled || !owner) return;
      setNames(addNames(contract, owner, rows));
      window.dispatchEvent(new Event("kb-luma"));
    },
    [contract, owner, enabled],
  );
  const check = useCallback(
    (wallet: string) => {
      const { book, before } = markChecked(contract, wallet, Date.now());
      setChecked(book);
      return before;
    },
    [contract],
  );
  const nameOf = useCallback(
    (wallet: string) => (enabled ? names[wallet.toLowerCase()]?.name : undefined),
    [names, enabled],
  );
  const lumaOf = useCallback((wallet: string) => names[wallet.toLowerCase()]?.luma, [names]);
  const approvedAt = useCallback((wallet: string) => checked[wallet.toLowerCase()], [checked]);
  return { names: enabled ? names : {}, checked, add, check, nameOf, lumaOf, approvedAt };
}
