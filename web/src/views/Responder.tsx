import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, request } from '../api';
import { useSession } from '../auth';
import { SosButton, errorText, useToast } from '../components';
import { formatDistance, formatMin, LocationPicker, useLocation } from '../geo';
import { useI18n } from '../i18n';
import { useLive, useSocketEvent } from '../live';
import { CityMap } from '../map/CityMap';
import type { IncidentAlert } from '../types';

const HEARTBEAT_MS = 30_000;

// Short, loud two-tone alarm using Web Audio (no audio file needed).
function alarm() {
  try {
    navigator.vibrate?.([400, 150, 400, 150, 400]);
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((start, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 2 ? 660 : 880;
      gain.gain.value = 0.25;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.25);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // audio can be blocked until the user interacts with the page
  }
}

export function ResponderView() {
  const { t } = useI18n();
  const { getToken, me } = useSession();
  const { socket, connected, snapshot } = useLive();
  const loc = useLocation();
  const toast = useToast();
  const [onDuty, setOnDuty] = useState(false);
  const [alerts, setAlerts] = useState<IncidentAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const posRef = useRef(loc.pos);
  posRef.current = loc.pos;

  // SRS FR 4.1: heartbeat every 30 s while on duty, and immediately when the position changes.
  useEffect(() => {
    if (!onDuty || !socket || !connected) return;
    const send = () => posRef.current && socket.emit('presence:update', posRef.current);
    send();
    const id = setInterval(send, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [onDuty, socket, connected, loc.pos?.lat, loc.pos?.lng]);

  const toggleDuty = () => {
    if (onDuty) socket?.emit('presence:off');
    setOnDuty(!onDuty);
  };

  const refresh = useCallback(() => {
    request<IncidentAlert[]>(getToken, 'GET', '/api/incidents/mine').then(setAlerts).catch(() => {});
  }, [getToken]);
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  useSocketEvent<IncidentAlert>(
    'incident:alert',
    useCallback((a) => {
      setAlerts((list) => [a, ...list.filter((x) => x.id !== a.id)]);
      alarm();
    }, []),
  );
  useSocketEvent<{ id: string; claimedBy: string }>(
    'incident:standdown',
    useCallback(
      (p) => {
        setAlerts((list) => list.filter((x) => x.id !== p.id));
        toast.show(t.standDown(p.claimedBy));
      },
      [t, toast.show],
    ),
  );

  const mine = alerts.find((a) => a.status === 'claimed' && a.claimedBy === me.sub);
  const incoming = alerts.find((a) => a.status === 'open' && !dismissed.has(a.id));

  const accept = async (a: IncidentAlert) => {
    setBusy(true);
    try {
      await request(getToken, 'POST', `/api/incidents/${a.id}/accept`);
      refresh();
    } catch (e) {
      toast.show(e instanceof ApiError && e.status === 409 ? t.alreadyTaken : errorText(e));
      setAlerts((list) => list.filter((x) => x.id !== a.id));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (a: IncidentAlert) => {
    await request(getToken, 'POST', `/api/incidents/${a.id}/resolve`).catch((e) => toast.show(errorText(e)));
    refresh();
  };

  return (
    <div className="phone-layout">
      <div className="toolbar">
        <span className={`pill ${onDuty ? 'pill-on' : ''}`}>{onDuty ? t.onDuty : t.offDuty}</span>
        <LocationPicker loc={loc} />
      </div>
      <button className={`btn btn-xl ${onDuty ? 'btn-ghost' : 'btn-primary'}`} onClick={toggleDuty} disabled={!loc.pos && !onDuty}>
        {onDuty ? t.goOffDuty : t.goOnDuty}
      </button>
      <p className="muted small">{loc.pos ? t.onDutyHint : t.locationNeeded}</p>

      {mine && (
        <section className="card card-alert">
          <h2>{t.activeIncident}</h2>
          <p className="big">
            {formatDistance(mine.distanceM)} {t.away} · ~{formatMin(mine.walkS)}
          </p>
          <div className="stack-sm">
            <a className="btn btn-primary btn-xl" href={mine.navigationUrl} target="_blank" rel="noreferrer">
              {t.navigate}
            </a>
            <button className="btn btn-xl" onClick={() => resolve(mine)}>
              {t.markResolved}
            </button>
          </div>
        </section>
      )}

      <CityMap shelters={snapshot?.shelters ?? []} me={loc.pos} incidents={alerts} height={300} />

      {incoming && (
        <div className="sheet-backdrop alarm">
          <div className="sheet sheet-alarm" role="alertdialog" aria-live="assertive">
            <div className="alarm-title">{t.incomingAlert}</div>
            <div className="alarm-distance">{formatDistance(incoming.distanceM)}</div>
            <div className="alarm-sub">
              {t.away} · ~{formatMin(incoming.walkS)} {t.walk}
            </div>
            <button className="btn btn-accept" disabled={busy} onClick={() => accept(incoming)}>
              {t.accept}
            </button>
            <button className="btn btn-ghost btn-xl" onClick={() => setDismissed((d) => new Set(d).add(incoming.id))}>
              {t.dismiss}
            </button>
          </div>
        </div>
      )}
      <SosButton pos={loc.pos} />
      {toast.node}
    </div>
  );
}
