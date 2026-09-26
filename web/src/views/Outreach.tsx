import { useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { useSession } from '../auth';
import { Countdown, SosButton, errorText, useToast } from '../components';
import { formatDistance, formatMin, LocationPicker, useLocation } from '../geo';
import { useI18n } from '../i18n';
import { useLive } from '../live';
import { CityMap } from '../map/CityMap';
import type { Hold, Match, Shelter } from '../types';

type Gender = 'woman' | 'man' | 'nonbinary';

export function OutreachView() {
  const { t } = useI18n();
  const loc = useLocation();
  const [tab, setTab] = useState<'beds' | 'find'>('find');
  return (
    <div className="phone-layout">
      <div className="toolbar">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={tab === 'find'} className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}>
            {t.tabFind}
          </button>
          <button role="tab" aria-selected={tab === 'beds'} className={tab === 'beds' ? 'on' : ''} onClick={() => setTab('beds')}>
            {t.tabBeds}
          </button>
        </div>
        <LocationPicker loc={loc} />
      </div>
      {tab === 'find' ? <FindBed pos={loc.pos} /> : <BedsList me={loc.pos} />}
      <SosButton pos={loc.pos} />
    </div>
  );
}

export function BedsList({ me }: { me: { lat: number; lng: number } | null }) {
  const { t } = useI18n();
  const { snapshot } = useLive();
  const shelters = [...(snapshot?.shelters ?? [])].sort((a, b) => b.available - a.available);
  return (
    <>
      <CityMap shelters={snapshot?.shelters ?? []} me={me} height={320} />
      <ul className="list">
        {shelters.map((s) => (
          <ShelterRow key={s.id} s={s} />
        ))}
      </ul>
      {snapshot && (
        <p className="muted small center">
          {t.cityAvailable}: {snapshot.totals.available} / {snapshot.totals.capacity} ({snapshot.totals.availablePct}%)
        </p>
      )}
    </>
  );
}

function ShelterRow({ s }: { s: Shelter }) {
  const { t } = useI18n();
  return (
    <li className="row">
      <span className={`dot dot-${s.status}`} aria-hidden />
      <div className="grow">
        <div className="row-title">
          {s.name} {s.kind === 'overflow' && <span className="tag">{t.overflow}</span>}
        </div>
        <div className="muted small">{s.address}</div>
      </div>
      <div className={`count count-${s.status}`}>{s.available ? s.available : t.full}</div>
    </li>
  );
}

function FindBed({ pos }: { pos: { lat: number; lng: number } | null }) {
  const { t } = useI18n();
  const { getToken } = useSession();
  const { snapshot } = useLive();
  const toast = useToast();
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [family, setFamily] = useState(false);
  const [accessibility, setAccessibility] = useState(false);
  const [substanceUse, setSubstanceUse] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [holds, setHolds] = useState<Hold[]>([]);

  const loadHolds = useCallback(() => {
    request<Hold[]>(getToken, 'GET', '/api/holds/mine').then(setHolds).catch(() => {});
  }, [getToken]);
  // Refresh holds when capacity changes (e.g. the shelter confirmed arrival or a hold expired).
  useEffect(loadHolds, [loadHolds, snapshot?.at]);

  const ageNum = Number(age);
  const ready = pos && gender && age !== '' && Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120;

  const search = async () => {
    if (!ready || !pos) return;
    setBusy('search');
    try {
      setMatches(
        await request<Match[]>(getToken, 'POST', '/api/match', {
          ...pos,
          age: ageNum,
          gender,
          family,
          accessibility,
          substanceUse,
        }),
      );
    } catch (e) {
      toast.show(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const hold = async (m: Match) => {
    setBusy(m.id);
    try {
      await request<Hold>(getToken, 'POST', '/api/holds', { shelterId: m.id });
      setMatches(null);
      loadHolds();
    } catch (e) {
      toast.show(errorText(e));
      void search();
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (h: Hold) => {
    await request(getToken, 'DELETE', `/api/holds/${h.id}`).catch((e) => toast.show(errorText(e)));
    loadHolds();
  };

  const shelterById = new Map((snapshot?.shelters ?? []).map((s) => [s.id, s]));

  return (
    <div className="stack">
      {holds.length > 0 && (
        <section className="card">
          <h2>{t.myHolds}</h2>
          {holds.map((h) => {
            const s = shelterById.get(h.shelterId);
            return (
              <div key={h.id} className="hold">
                <div className="grow">
                  <div className="row-title">{h.shelterName}</div>
                  <div className="muted small">{t.holdCode}</div>
                  <div className="hold-code">{h.code}</div>
                  <div className="small">
                    {t.expiresIn} <Countdown until={h.expireAt} />
                  </div>
                </div>
                <div className="stack-sm">
                  {s && (
                    <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=transit`} target="_blank" rel="noreferrer">
                      {t.directions}
                    </a>
                  )}
                  <button className="btn btn-ghost" onClick={() => cancel(h)}>
                    {t.cancel}
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="card">
        <label className="field">
          <span>{t.age}</span>
          <input className="input input-xl" inputMode="numeric" pattern="[0-9]*" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </label>
        <div className="field">
          <span>{t.gender}</span>
          <div className="choice-grid">
            {(['woman', 'man', 'nonbinary'] as const).map((g) => (
              <button key={g} className={`choice ${gender === g ? 'on' : ''}`} aria-pressed={gender === g} onClick={() => setGender(g)}>
                {t[g]}
              </button>
            ))}
          </div>
        </div>
        <Toggle label={t.family} value={family} onChange={setFamily} />
        <Toggle label={t.accessibility} value={accessibility} onChange={setAccessibility} />
        <Toggle label={t.substanceUse} value={substanceUse} onChange={setSubstanceUse} />
        <button className="btn btn-primary btn-xl" disabled={!ready || busy === 'search'} onClick={search}>
          {t.findShelters}
        </button>
        <p className="muted small">{pos ? t.notStored : t.locationNeeded}</p>
      </section>

      {matches && (
        <section className="stack">
          {matches.length === 0 && <p className="card warn">{t.noMatches}</p>}
          {matches.map((m) => (
            <div key={m.id} className="card match">
              <div className="grow">
                <div className="row-title">{m.name}</div>
                <div className="muted small">
                  {formatDistance(m.distanceM)} · {formatMin(m.travel.walkS)} {t.walk}
                  {m.travel.transitS !== null && ` · ${formatMin(m.travel.transitS)} ${t.transit}`}
                  {m.travel.source === 'estimate' && ` (${t.estimate})`}
                </div>
              </div>
              <div className={`count count-${m.status}`}>{m.available}</div>
              <button className="btn btn-primary" disabled={busy === m.id} onClick={() => hold(m)}>
                {busy === m.id ? t.holding : t.holdBed}
              </button>
            </div>
          ))}
        </section>
      )}
      {toast.node}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span>{label}</span>
      <span className="toggle-knob" aria-hidden />
    </button>
  );
}
