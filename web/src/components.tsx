import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, request } from './api';
import { useSession } from './auth';
import type { LatLng } from './geo';
import { useI18n } from './i18n';
import { useLive, useSocketEvent } from './live';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Countdown({ until }: { until: string }) {
  const now = useNow();
  const ms = Math.max(0, new Date(until).getTime() - now);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return (
    <span className={`countdown ${ms < 5 * 60_000 ? 'countdown-low' : ''}`}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'green' | 'yellow' | 'red' | 'blue' }) {
  const isText = typeof value === 'string' && /[a-zà-ÿ]{3}/i.test(value);
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''} ${isText ? 'stat-text' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(id);
  }, [msg]);
  const node = msg ? (
    <div className="toast" role="status" onClick={() => setMsg(null)}>
      {msg}
    </div>
  ) : null;
  return { show: setMsg, node };
}

export function errorText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : String(e);
}

// ---- Overdose alert (SRS Module 4 and FR 5.2) --------------------------------------------------
type SosState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; id: string; alertedCount: number; responder?: { name: string; etaS: number }; resolved?: boolean }
  | { kind: 'offline'; smsHref: string }
  | { kind: 'error'; message: string };

export function SosButton({ pos }: { pos: LatLng | null }) {
  const { t } = useI18n();
  const { getToken } = useSession();
  const { online, connected, publicConfig } = useLive();
  const [state, setState] = useState<SosState>({ kind: 'idle' });

  useSocketEvent<{ id: string; responderName: string; etaS: number }>(
    'incident:claimed',
    useCallback((p) => {
      setState((s) => (s.kind === 'sent' && s.id === p.id ? { ...s, responder: { name: p.responderName, etaS: p.etaS } } : s));
    }, []),
  );
  useSocketEvent<{ id: string }>(
    'incident:resolved',
    useCallback((p) => {
      setState((s) => (s.kind === 'sent' && s.id === p.id ? { ...s, resolved: true } : s));
    }, []),
  );

  const trigger = async () => {
    if (!pos) return setState({ kind: 'error', message: t.locationNeeded });
    if (!online || !connected) {
      const number = publicConfig?.smsNumber ?? '';
      const body = `OD ${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`;
      return setState({ kind: 'offline', smsHref: `sms:${number}?&body=${encodeURIComponent(body)}` });
    }
    setState({ kind: 'sending' });
    try {
      const res = await request<{ id: string; alertedCount: number }>(getToken, 'POST', '/api/incidents', pos);
      setState({ kind: 'sent', id: res.id, alertedCount: res.alertedCount });
    } catch (e) {
      setState({ kind: 'error', message: errorText(e) });
    }
  };

  return (
    <>
      <div className="sos-dock">
        <button className="sos" onClick={trigger} aria-label={t.sosHint}>
          <span className="sos-label">{t.sos}</span>
          <span className="sos-hint">{t.sosHint}</span>
        </button>
      </div>
      {state.kind !== 'idle' && (
        <div className="sheet-backdrop">
          <div className="sheet" role="alertdialog" aria-live="assertive">
            <a className="btn btn-911" href="tel:911">
              📞 {t.call911}
            </a>
            <p className="sheet-lead">{t.call911Now}</p>
            {state.kind === 'sending' && <p className="status-line">{t.alerting}</p>}
            {state.kind === 'sent' && (
              <>
                <p className={`status-line ${state.alertedCount ? 'ok' : 'warn'}`}>
                  {state.alertedCount ? t.alerted(state.alertedCount) : t.noResponders}
                </p>
                {state.responder && (
                  <p className="status-line ok">{t.onTheWay(state.responder.name, Math.max(1, Math.round(state.responder.etaS / 60)))}</p>
                )}
                {state.resolved && <p className="status-line">{t.resolvedMsg}</p>}
              </>
            )}
            {state.kind === 'offline' && (
              <>
                <p className="status-line warn">{t.offlineSms}</p>
                <a className="btn btn-primary btn-xl" href={state.smsHref}>
                  {t.sendSms}
                </a>
              </>
            )}
            {state.kind === 'error' && <p className="status-line warn">{state.message}</p>}
            <button className="btn btn-ghost btn-xl" onClick={() => setState({ kind: 'idle' })}>
              {t.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
