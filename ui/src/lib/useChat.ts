import { useSyncExternalStore } from "react";
import { getElapsed, getMessages, isBusy, subscribe } from "./chatStore";

/** Subscribe a screen to the conversation. Survives navigation. */
export function useChat() {
  const messages = useSyncExternalStore(subscribe, getMessages, getMessages);
  const busy = useSyncExternalStore(subscribe, isBusy, isBusy);
  const elapsed = useSyncExternalStore(subscribe, getElapsed, getElapsed);
  return { messages, busy, elapsed };
}
