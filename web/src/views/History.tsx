import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { request } from '../api';
import { useSession } from '../auth';
import { Stat, errorText, useToast } from '../components';
import { useI18n } from '../i18n';
import { useLive } from '../live';

type Range = '24h' | '7d';
type Point = { t: string; avgPct: number | null; minPct: number | null; avgTemp: number | null; minTemp: number | null };
type HistoryResponse = {
  status: { enabled: boolean; ready: boolean; lastError: string | null };
  city: { range: Range; bucket: string; points: Point[]; simulated: boolean; overridden: boolean } | null;
  shelters: { shelterId: string; shareFull: number | null; avgAvailable: number; simulated: boolean }[] | null;
  incidents: {
    alerts: number;
    noResponder: number;
    claimed: number;
    p50DispatchMs: number | null;
    p90DispatchMs: number | null;
    p50ClaimS: number | null;
  } | null;
};

// Tiger Data (TimescaleDB) history for City Ops.
export function HistoryPanel() {
  const { t } = useI18n();
  const { getToken } = useSession();
  const { snapshot, publicConfig } = useLive();
  const toast = useToast();
  const [range, setRange] = useState<Range>('24h');
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await request<HistoryResponse>(getToken, 'GET', `/api/history?range=${range}`));
    } catch (e) {
      toast.show(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [getToken, range, toast.show]);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const demo = async (clear: boolean) => {
    try {
      const res = await request<{ reason: string }>(getToken, 'POST', '/api/demo/history', clear ? { clear: true } : {});
      toast.show(res.reason);
      await load();
    } catch (e) {
      toast.show(errorText(e));
    }
  };

  const names = new Map((snapshot?.shelters ?? []).map((s) => [s.id, s.name]));
  const tag = publicConfig?.integrations.history ?? 'off';

  if (data && !data.status.enabled) {
    return (
      <section className="card">
        <h2>
          {t.history} <span className="tag">off</span>
        </h2>
        <p className="muted">{t.historyOff}</p>
      </section>
    );
  }

  const city = data?.city;
  const points = city?.points ?? [];
  const inc = data?.incidents;

  return (
    <section className="card history">
      <h2>
        {t.history} <span className="tag">{tag}</span>
        {city?.simulated && <span className="tag tag-simulated">{t.simulatedBadge}</span>}
      </h2>

      <div className="filter-row">
        <div className="segmented" role="radiogroup" aria-label={t.range}>
          {(['24h', '7d'] as const).map((r) => (
            <button key={r} role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r === '24h' ? t.last24h : t.last7d}
            </button>
          ))}
        </div>
        {data?.status.lastError && <span className="warn small">{data.status.lastError}</span>}
      </div>

      <div className={`history-body ${loading && data ? 'refetching' : ''}`}>
        {city?.simulated && <p className="small warn">{t.simulatedNote}</p>}
        {points.length === 0 ? (
          <p className="muted">{data ? t.historyEmpty : '…'}</p>
        ) : (
          <>
            <LineChart
              title={t.chartBeds}
              points={points.map((p) => ({ t: p.t, v: p.avgPct }))}
              format={(v) => `${v.toFixed(1)}%`}
              threshold={{ value: 1, label: t.codeFrostLine('1%') }}
              range={range}
              floorZero
            />
            <LineChart
              title={t.chartTemp}
              points={points.map((p) => ({ t: p.t, v: p.minTemp }))}
              format={(v) => `${v.toFixed(1)}°C`}
              threshold={{ value: -15, label: t.codeFrostLine('−15°C') }}
              range={range}
            />
            <details className="table-view">
              <summary>{t.showTable}</summary>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.time}</th>
                    <th className="num">{t.chartBeds}</th>
                    <th className="num">{t.lowestPct}</th>
                    <th className="num">{t.chartTemp}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((p) => (
                    <tr key={p.t}>
                      <td>{fmtTime(p.t, range)}</td>
                      <td className="num">{p.avgPct?.toFixed(2) ?? '—'}</td>
                      <td className="num">{p.minPct?.toFixed(2) ?? '—'}</td>
                      <td className="num">{p.minTemp?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}

        {data?.shelters && data.shelters.length > 0 && (
          <div className="chart-block">
            <h3 className="chart-title">{t.chartFull}</h3>
            <ul className="barlist">
              {data.shelters.map((s) => {
                const pct = Math.round((s.shareFull ?? 0) * 100);
                return (
                  <li key={s.shelterId} title={`${names.get(s.shelterId) ?? s.shelterId}: ${pct}%`}>
                    <span className="barlist-label">{names.get(s.shelterId) ?? s.shelterId}</span>
                    <span className="barlist-track">
                      <span className="barlist-bar" style={{ width: `${Math.max(pct, 0)}%` }} />
                      <span className="barlist-value">{pct}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {inc && (
          <div className="chart-block">
            <h3 className="chart-title">{t.responseTimes}</h3>
            <div className="stats">
              <Stat label={t.alertsCount} value={inc.alerts} />
              <Stat label={t.medianDispatch} value={inc.p50DispatchMs === null ? '—' : `${inc.p50DispatchMs} ms`} />
              <Stat label={t.medianClaim} value={inc.p50ClaimS === null ? '—' : `${inc.p50ClaimS} s`} />
              <Stat label={t.noResponderAlerts} value={inc.noResponder} tone={inc.noResponder ? 'yellow' : undefined} />
            </div>
          </div>
        )}
      </div>

      {publicConfig?.demoControls && (
        <details className="demo">
          <summary>{t.demoControls}</summary>
          <div className="inline-form">
            <button className="btn" onClick={() => demo(false)}>
              {t.loadSimulated}
            </button>
            <button className="btn btn-ghost" onClick={() => demo(true)}>
              {t.clearSimulated}
            </button>
          </div>
        </details>
      )}
      {toast.node}
    </section>
  );
}

function fmtTime(iso: string, range: Range) {
  const d = new Date(iso);
  return range === '24h'
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

type LinePoint = { t: string; v: number | null };

// Single-series line chart: 2px line, 10% area wash, threshold reference line, crosshair tooltip.
function LineChart({
  title,
  points,
  format,
  threshold,
  range,
  floorZero = false,
}: {
  title: string;
  points: LinePoint[];
  format: (v: number) => string;
  threshold: { value: number; label: string };
  range: Range;
  floorZero?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 180;
  const m = { top: 12, right: 16, bottom: 26, left: 52 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const values = points.map((p) => p.v).filter((v): v is number => v !== null);
  let lo = Math.min(...values, threshold.value);
  let hi = Math.max(...values, threshold.value);
  if (floorZero) lo = Math.min(0, lo);
  const pad = (hi - lo) * 0.08 || 1;
  lo = floorZero ? lo : lo - pad;
  hi += pad;
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]);
  hi = Math.max(hi, ticks[ticks.length - 1]);

  const t0 = new Date(points[0].t).getTime();
  const t1 = new Date(points[points.length - 1].t).getTime();
  const x = (iso: string) => m.left + (t1 === t0 ? iw / 2 : ((new Date(iso).getTime() - t0) / (t1 - t0)) * iw);
  const y = (v: number) => m.top + ih - ((v - lo) / (hi - lo)) * ih;

  // Split into segments at gaps (null values) so the line never bridges missing data.
  const segments: LinePoint[][] = [];
  let cur: LinePoint[] = [];
  for (const p of points) {
    if (p.v === null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) segments.push(cur);
  const path = (seg: LinePoint[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v!).toFixed(1)}`).join('');
  const area = (seg: LinePoint[]) =>
    `${path(seg)}L${x(seg[seg.length - 1].t).toFixed(1)},${y(lo).toFixed(1)}L${x(seg[0].t).toFixed(1)},${y(lo).toFixed(1)}Z`;

  // X ticks: every 6 h for 24 h, every day for 7 d.
  const stepMs = range === '24h' ? 6 * 3_600_000 : 86_400_000;
  const xTicks: number[] = [];
  const first = Math.ceil(t0 / stepMs) * stepMs;
  for (let tt = first; tt <= t1; tt += stepMs) xTicks.push(tt);
  const xLabel = (ms: number) =>
    range === '24h'
      ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : new Date(ms).toLocaleDateString([], { weekday: 'short' });

  const nearest = (px: number) => {
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(p.t) - px);
      if (d < bestD && p.v !== null) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setActive(nearest(e.clientX - box.left));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    let i = active ?? points.length - 1;
    do i += dir;
    while (i >= 0 && i < points.length && points[i].v === null);
    if (i >= 0 && i < points.length) setActive(i);
  };

  const last = [...points].reverse().find((p) => p.v !== null);
  const a = active !== null ? points[active] : null;

  return (
    <div className="chart-block">
      <h3 className="chart-title">{title}</h3>
      <div className="chart" ref={wrap}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. ${last ? format(last.v!) : ''}`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((i) => i ?? points.length - 1)}
          onBlur={() => setActive(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid" x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
              <text className="axis" x={m.left - 8} y={y(v)} dy="0.32em" textAnchor="end">
                {format(v)}
              </text>
            </g>
          ))}
          {xTicks.map((tt) => (
            <text key={tt} className="axis" x={x(new Date(tt).toISOString())} y={height - 6} textAnchor="middle">
              {xLabel(tt)}
            </text>
          ))}
          <line className="threshold" x1={m.left} x2={width - m.right} y1={y(threshold.value)} y2={y(threshold.value)} />
          <text className="threshold-label" x={m.left + 6} y={y(threshold.value) - 5} textAnchor="start">
            {threshold.label}
          </text>
          {segments.map((seg, i) => (
            <g key={i}>
              <path className="area" d={area(seg)} />
              <path className="line" d={path(seg)} />
            </g>
          ))}
          {last && !a && <circle className="dot" cx={x(last.t)} cy={y(last.v!)} r={4} />}
          {a && a.v !== null && (
            <>
              <line className="crosshair" x1={x(a.t)} x2={x(a.t)} y1={m.top} y2={m.top + ih} />
              <circle className="dot" cx={x(a.t)} cy={y(a.v)} r={4} />
            </>
          )}
          <rect
            x={m.left}
            y={m.top}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {a && a.v !== null && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(x(a.t), 70), width - 70), top: m.top }}>
            <strong>{format(a.v)}</strong>
            <span>{fmtTime(a.t, range)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
