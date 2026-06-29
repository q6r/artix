"use client";

import { useEffect, useRef } from "react";
import { wsClient, type WsHandler } from "@/lib/ws/client";

/**
 * Subscribe to a gateway topic for the lifetime of the component. The handler
 * may change between renders without re-subscribing. Pass `null` to skip.
 */
export function useSubscription(topic: string | null, handler: WsHandler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    if (!topic) return;
    const unsub = wsClient.subscribe(topic, (event, data) => ref.current(event, data));
    return unsub;
  }, [topic]);
}
