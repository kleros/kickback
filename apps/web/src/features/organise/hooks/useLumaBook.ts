"use client";

import { useCallback, useEffect, useState } from "react";

import { addNames, markChecked, readChecked, readNames, type CheckedBook, type LumaBook } from "../model/lumaBook";

/** The organiser's local Luma names and door checks for one event, shared by the tabs. */
export function useLumaBook(contract: string) {
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
      setNames(addNames(contract, rows));
      window.dispatchEvent(new Event("kb-luma"));
    },
    [contract],
  );
  const check = useCallback(
    (wallet: string) => {
      const { book, before } = markChecked(contract, wallet, Date.now());
      setChecked(book);
      return before;
    },
    [contract],
  );
  const nameOf = useCallback((wallet: string) => names[wallet.toLowerCase()]?.name, [names]);
  return { names, checked, add, check, nameOf };
}
