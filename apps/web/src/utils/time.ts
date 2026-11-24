/** JS dates stop at ±8.64e15 ms; a contract can hold any uint64, so check a unix time before formatting it. */
export const isShowableTime = (unix: number) => Number.isFinite(unix) && Math.abs(unix) <= 8.64e12;
