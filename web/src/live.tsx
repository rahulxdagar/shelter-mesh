import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, request } from './api';
import { useSession } from './auth';
import { load, save } from './storage';
import type { CodeFrostState, PublicConfig, Snapshot } from './types';

type Live = {
  socket: Socket | null;
  connected: boolean;
  online: boolean;
  snapshot: Snapshot | null;
  snapshotIsCached: boolean;
  codeFrost: CodeFrostState | null;
  publicConfig: PublicConfig | null;
};

const LiveContext = createContext<Live>({
  socket: null,
  connected: false,
  online: true,
  snapshot: null,
  snapshotIsCached: false,
  codeFrost: null,
  publicConfig: null,
});

export const useLive = () => useContext(LiveContext);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { getToken } = useSession();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  // SRS FR 5.1: start from the last snapshot this device saw, so the map works offline.
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => load<Snapshot>('snapshot'));
  const [snapshotIsCached, setCached] = useState(true);
  const [codeFrost, setCodeFrost] = useState<CodeFrostState | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    request<PublicConfig>(null, 'GET', '/api/public-config').then(setPublicConfig).catch(() => {});
    request<CodeFrostState>(getToken, 'GET', '/api/codefrost').then(setCodeFrost).catch(() => {});
  }, [getToken]);

  useEffect(() => {
    const s = io(API_URL || undefined, {
      // A function, so reconnects fetch a fresh token.
      auth: (cb) => {
        getToken().then((token) => cb({ token }), () => cb({}));
      },
    });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('snapshot', (snap: Snapshot) => {
      setSnapshot(snap);
      setCached(false);
      save('snapshot', snap);
    });
    s.on('codefrost', (state: CodeFrostState) => setCodeFrost(state));
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
    };
  }, [getToken]);

  return (
    <LiveContext.Provider value={{ socket, connected, online, snapshot, snapshotIsCached, codeFrost, publicConfig }}>
      {children}
    </LiveContext.Provider>
  );
}

// Subscribe to a socket event for the lifetime of a component.
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useLive();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}
