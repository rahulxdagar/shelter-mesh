import { useCallback, useEffect, useState } from 'react';
import { API_URL, request } from '../api';
import { useSession } from '../auth';
import { Stat, errorText, useToast } from '../components';
import { useI18n } from '../i18n';
import { useLive, useSocketEvent } from '../live';
import { CityMap } from '../map/CityMap';
import type { AuditEntry, Incident, OutboxEntry, Verification } from '../types';
import { HistoryPanel } from './History';
import { BedsList } from './Outreach';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function upsert<T extends { id: string }>(list: T[], item: T, max = 100): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [item, ...list].slice(0, max);
  const copy = [...list];
  copy[i] = item;
  return copy;
}

export function OpsView() {
  const { t } = useI18n();
  const { snapshot, codeFrost } = useLive();
  const { getToken } = useSession();
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    request<Incident[]>(getToken, 'GET', '/api/incidents').then(setIncidents).catch(() => {});
  }, [getToken]);
  useSocketEvent<Incident>('incident', useCallback((i) => setIncidents((l) => upsert(l, i, 20)), []));

  const totals = snapshot?.totals;
  const reading = codeFrost?.weather.reading;
  const cfStatus = codeFrost?.event?.status ?? 'none';
  const openIncidents = incidents.filter((i) => i.status !== 'resolved');

  return (
    <div className="ops">
      <div className="stats stats-wide">
        <Stat
          label={t.cityAvailable}
          value={totals ? `${totals.available} / ${totals.capacity}` : '—'}
          tone={totals && totals.availablePct < 1 ? 'red' : totals && totals.availablePct < 5 ? 'yellow' : 'green'}
        />
        <Stat label={t.pctFree} value={totals ? `${totals.availablePct}%` : '—'} />
        <Stat label={t.overflow} value={totals ? totals.overflowAvailable : '—'} tone={totals?.overflowActive ? 'blue' : undefined} />
        <Stat
          label={`${t.feelsLike}${codeFrost?.weather.overridden ? ' (demo)' : ''}`}
          value={reading ? `${reading.effectiveTempC}°C` : '—'}
          tone={reading && reading.effectiveTempC < (codeFrost?.thresholds.effectiveTempBelowC ?? -15) ? 'blue' : undefined}
        />
        <Stat label={t.codeFrost} value={t[`status_${cfStatus}`]} tone={cfStatus === 'pending_authorization' ? 'red' : cfStatus === 'active' ? 'blue' : undefined} />
      </div>

      <div className="ops-grid">
        <div className="ops-main">
          <CityMap shelters={snapshot?.shelters ?? []} incidents={openIncidents} height="min(62vh, 640px)" />
          <IncidentsPanel incidents={incidents} />
          <HistoryPanel />
        </div>
        <div className="ops-side">
          <CodeFrostPanel />
          <OutboxPanel />
          <AuditPanel />
          <details className="card">
            <summary>{t.tabBeds}</summary>
            <BedsList me={null} />
          </details>
        </div>
      </div>
    </div>
  );
}

function IncidentsPanel({ incidents }: { incidents: Incident[] }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <h2>{t.incidents}</h2>
      {incidents.length === 0 && <p className="muted">{t.noIncidents}</p>}
      <table className="table">
        <tbody>
          {incidents.map((i) => (
            <tr key={i.id}>
              <td>{time(i.createdAt)}</td>
              <td>
                <span className={`tag tag-${i.status}`}>{i.status}</span>
                {i.source === 'sms' && <span className="tag">SMS</span>}
              </td>
              <td>{t.alerted(i.alertedCount)}</td>
              <td className="num">
                {i.dispatchMs ?? '—'} ms {t.dispatch}
              </td>
              <td className="num">
                {i.claimedAt ? `${Math.round((new Date(i.claimedAt).getTime() - new Date(i.createdAt).getTime()) / 1000)} s → ${i.claimedByName ?? i.claimedBy}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CodeFrostPanel() {
  const { t } = useI18n();
  const { codeFrost, publicConfig } = useLive();
  const { getToken } = useSession();
  const toast = useToast();
  const [temp, setTemp] = useState('-22');
  const [wind, setWind] = useState('30');

  const call = async (path: string, body?: unknown) => {
    try {
      const res = await request<{ reason?: string }>(getToken, 'POST', path, body);
      if (res?.reason) toast.show(res.reason);
    } catch (e) {
      toast.show(errorText(e));
    }
  };

  const cf = codeFrost;
  const status = cf?.event?.status ?? 'none';
  const open = status === 'pending_authorization' || status === 'active';
  return (
    <section className={`card ${status === 'pending_authorization' ? 'card-alert' : ''}`}>
      <h2>{t.codeFrost}</h2>
      {cf && (
        <ul className="conditions">
          <li className={cf.conditions.capacity ? 'met' : ''}>
            {t.bedsCondition} {cf.thresholds.availablePctBelow}%: <strong>{cf.availablePct}%</strong>
          </li>
          <li className={cf.conditions.temperature ? 'met' : ''}>
            {t.tempCondition} {cf.thresholds.effectiveTempBelowC}°C:{' '}
            <strong>{cf.weather.reading ? `${cf.weather.reading.effectiveTempC}°C` : '—'}</strong>
            <span className="muted small">
              {' '}
              {cf.weather.reading &&
                `(${cf.weather.reading.tempC}°C, ${cf.weather.reading.windKmh} km/h · ${cf.weather.reading.station})`}
            </span>
          </li>
        </ul>
      )}
      <div className="stack-sm">
        {status === 'pending_authorization' && (
          <button className="btn btn-danger btn-xl" onClick={() => call('/api/codefrost/authorize')}>
            {t.authorize}
          </button>
        )}
        {open && (
          <button className="btn" onClick={() => call('/api/codefrost/end')}>
            {t.endCodeFrost}
          </button>
        )}
        <button className="btn" onClick={() => call('/api/codefrost/evaluate')}>
          {t.evaluate}
        </button>
      </div>
      {publicConfig?.demoControls && (
        <details className="demo">
          <summary>{t.demoControls}</summary>
          <div className="inline-form">
            <label>
              °C <input className="input input-sm" value={temp} onChange={(e) => setTemp(e.target.value)} />
            </label>
            <label>
              km/h <input className="input input-sm" value={wind} onChange={(e) => setWind(e.target.value)} />
            </label>
            <button className="btn" onClick={() => call('/api/codefrost/override', { tempC: Number(temp), windKmh: Number(wind) })}>
              {t.applyOverride}
            </button>
            <button className="btn btn-ghost" onClick={() => call('/api/codefrost/override', { clear: true })}>
              {t.clearOverride}
            </button>
          </div>
          <div className="inline-form">
            <button className="btn" onClick={() => call('/api/demo/surge')}>
              {t.surge}
            </button>
            <button className="btn btn-ghost" onClick={() => call('/api/demo/reset')}>
              {t.reset}
            </button>
          </div>
        </details>
      )}
      {toast.node}
    </section>
  );
}

function OutboxPanel() {
  const { t } = useI18n();
  const { getToken } = useSession();
  const { publicConfig } = useLive();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    request<OutboxEntry[]>(getToken, 'GET', '/api/outbox').then(setEntries).catch(() => {});
  }, [getToken]);
  useSocketEvent<OutboxEntry>('outbox', useCallback((e) => setEntries((l) => upsert(l, e, 50)), []));

  // Dev only: plays the on-call manager replying to the (simulated) Code Frost SMS.
  const simulateReply = async (to: string) => {
    await fetch(`${API_URL}/api/twilio/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: to, Body: 'AUTHORIZE' }),
    });
  };

  return (
    <section className="card">
      <h2>
        {t.comms} <span className="tag">{publicConfig?.integrations.sms}</span>
      </h2>
      <ul className="feed">
        {entries.slice(0, 30).map((e) => (
          <li key={e.id}>
            <div className="feed-meta">
              {time(e.at)} · {e.channel.toUpperCase()} {e.direction === 'in' ? `← ${e.from}` : `→ ${e.to}`} ·{' '}
              <span className={`tag tag-${e.status}`}>{e.status}</span>
            </div>
            <div className="feed-body">{e.body}</div>
            {e.error && <div className="warn small">{e.error}</div>}
            {e.status === 'simulated' && e.channel === 'sms' && e.body.includes('Reply AUTHORIZE') && (
              <button className="btn btn-sm" onClick={() => simulateReply(e.to)}>
                {t.simulateReply}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditPanel() {
  const { t } = useI18n();
  const { getToken } = useSession();
  const { publicConfig } = useLive();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [checks, setChecks] = useState<Record<string, Verification | string>>({});
  useEffect(() => {
    request<AuditEntry[]>(getToken, 'GET', '/api/audit').then(setEntries).catch(() => {});
  }, [getToken]);
  useSocketEvent<AuditEntry>('audit', useCallback((e) => setEntries((l) => upsert(l, e)), []));

  const verify = async (id: string) => {
    try {
      const v = await request<Verification>(getToken, 'GET', `/api/audit/${id}/verify`);
      setChecks((c) => ({ ...c, [id]: v }));
    } catch (e) {
      setChecks((c) => ({ ...c, [id]: errorText(e) }));
    }
  };

  return (
    <section className="card">
      <h2>
        {t.audit} <span className="tag">{publicConfig?.integrations.ledger}</span>
      </h2>
      <ul className="feed">
        {entries.slice(0, 30).map((e) => {
          const v = checks[e.id];
          return (
            <li key={e.id}>
              <div className="feed-meta">
                {time(e.at)} · <strong>{e.type}</strong> ·{' '}
                <span className="tag">
                  {e.ledger.mode === 'hedera' ? `${e.ledger.status}${e.ledger.sequenceNumber ? ` #${e.ledger.sequenceNumber}` : ''}` : t.localChain}
                </span>
              </div>
              <div className="feed-row">
                <span className="mono muted">{e.hash.slice(0, 16)}…</span>
                <button className="btn btn-sm" onClick={() => verify(e.id)}>
                  {t.verify}
                </button>
                {typeof v === 'string' && <span className="warn small">{v}</span>}
                {v && typeof v === 'object' && (
                  <span className={`small ${v.hashMatches ? 'ok' : 'warn'}`}>
                    {v.hashMatches ? `✓ ${t.verified}` : `✗ ${t.tampered}`}
                    {v.ledger.mode === 'hedera' && v.ledger.ledgerMatches && ` · ✓ ${t.onLedger}`}
                    {v.ledger.mode === 'hedera' && v.ledger.explorerUrl && (
                      <>
                        {' · '}
                        <a href={v.ledger.explorerUrl} target="_blank" rel="noreferrer">
                          HashScan
                        </a>
                      </>
                    )}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
