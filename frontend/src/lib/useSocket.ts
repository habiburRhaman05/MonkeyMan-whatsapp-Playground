"use client";

import { useEffect, useRef } from "react";
import { API_BASE } from "./api";

type Handler = (msg: any) => void;

interface Options {
  onOpen?: (isReconnect: boolean) => void;
  onClose?: () => void;
}

const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

/**
 * One WebSocket with auto-reconnect (1s -> 30s backoff).
 * Calls handlers[msg.type](msg) for each server event.
 */
export function useSocket(handlers: Record<string, Handler>, options: Options = {}) {
  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);
  handlersRef.current = handlers;
  optionsRef.current = options;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1000;
    let stopped = false;
    let everOpened = false;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        delay = 1000;
        optionsRef.current.onOpen?.(everOpened);
        everOpened = true;
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          handlersRef.current[msg.type]?.(msg);
        } catch {}
      };
      ws.onclose = () => {
        if (stopped) return;
        optionsRef.current.onClose?.();
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);
}
