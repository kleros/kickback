import { createStore } from "zustand/vanilla";

/** One wallet action at a time, app-wide: while one runs, every other send is refused. */
export const sendLock = createStore<{ busy: boolean }>(() => ({ busy: false }));

/** Takes the lock synchronously, so two calls in the same tick cannot both get it. False when it is held. */
export const acquireSendLock = (): boolean => {
  if (sendLock.getState().busy) return false;
  sendLock.setState({ busy: true });
  return true;
};

export const releaseSendLock = () => sendLock.setState({ busy: false });
