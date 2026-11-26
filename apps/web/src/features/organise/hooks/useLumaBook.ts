"use client";

import { useCallback, useEffect, useState } from "react";

import { addNames, markChecked, readChecked, readNames, type CheckedBook, type LumaBook } from "../model/lumaBook";

/**
 * The organiser's local Luma names and door checks for one event, shared by the tabs. Names are shown only
 * while `enabled` (the organiser's wallet is connected); door checks always count, so no one is approved twice.
 */
export function useLumaBook(contract: string, enabled: boolean) {
  const [names, setNames] = useState<LumaBook>({});
  const [checked, setChecked] = useState<CheckedBook>({});
  useEffect(() => {
    const load = () => {
      setNames(readNames(contract));
      setChecked(readChecked(contract));
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener("kb-luma", load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener("kb-luma", load);
    };
  }, [contract]);
  const add = useCallback(
    (rows: Parameters<typeof addNames>[1]) => {
      if (!enabled) return;
      setNames(addNames(contract, rows));
      window.dispatchEvent(new Event("kb-luma"));
    },
    [contract, enabled],
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
  const lumaOf = useCallback(
    (wallet: string) => (enabled ? names[wallet.toLowerCase()]?.luma : undefined),
    [names, enabled],
  );
  const approvedAt = useCallback((wallet: string) => checked[wallet.toLowerCase()], [checked]);
  return { names: enabled ? names : {}, checked, add, check, nameOf, lumaOf, approvedAt };
}
