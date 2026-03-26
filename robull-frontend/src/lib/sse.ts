'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { SSEEvent } from '@/types';

const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL ?? `${process.env.NEXT_PUBLIC_API_URL ?? 'https://robull-production.up.railway.app'}/v1/stream`;

export function useSSE(onEvent: (event: SSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(STREAM_URL);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        onEventRef.current(event);
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Reconnect with exponential backoff (max 30s)
      reconnectTimer.current = setTimeout(connect, 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);
}
