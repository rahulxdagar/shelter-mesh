import { useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { useSession } from '../auth';
import { Countdown, Stat, errorText, useToast } from '../components';
import { useI18n } from '../i18n';
import { useLive } from '../live';
import type { Hold } from '../types';

export function ShelterView() {
  const { t } = useI18n();
  const { me, getToken } = useSession();
  const { snapshot } = useLive();
  const toast = useToast();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [capacityInput, setCapacityInput] = useState('');
  const shelter = snapshot?.shelters.find((s) => s.id === me.shelterId);

  const loadHolds = useCallback(() => {
    if (!me.shelterId) return;
    request<Hold[]>(getToken, 'GET', `/api/shelters/${me.shelterId}/holds`).then(setHolds).catch(() => {});
  }, [getToken, me.shelterId]);
  // The snapshot changes whenever a hold is created, confirmed or expires.
  useEffect(loadHolds, [loadHolds, shelter?.held, shelter?.occupied]);

  if (!me.shelterId) return <p className="card warn">{t.noShelter}</p>;
  if (!shelter) return <p className="muted">…</p>;

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.show(errorText(e));
    }
  };
  const bump = (delta: 1 | -1) => act(() => request(getToken, 'POST', `/api/shelters/${shelter.id}/occupancy`, { delta }));
  const setCapacity = () =>
    act(async () => {
      await request(getToken, 'PATCH', `/api/shelters/${shelter.id}`, { capacity: Number(capacityInput) });
      setCapacityInput('');
    });
  const confirm = (h: Hold) =>
    act(async () => {
      await request(getToken, 'POST', `/api/holds/${h.id}/confirm`);
      loadHolds();
    });

  return (
    <div className="desk-layout">
      <section className="card">
        <h1 className="h-shelter">{shelter.name}</h1>
        <div className="stats">
          <Stat label={t.available} value={shelter.available} tone={shelter.status} />
          <Stat label={t.occupied} value={shelter.occupied} />
          <Stat label={t.held} value={shelter.held} tone="blue" />
          <Stat label={t.capacity} value={shelter.capacity} />
        </div>
        <div className="button-pair">
          <button className="btn btn-primary btn-xl" onClick={() => bump(1)} disabled={shelter.occupied >= shelter.capacity}>
            {t.checkIn}
          </button>
          <button className="btn btn-xl" onClick={() => bump(-1)} disabled={shelter.occupied <= 0}>
            {t.checkOut}
          </button>
        </div>
        <div className="inline-form">
          <input
            className="input"
            inputMode="numeric"
            placeholder={String(shelter.capacity)}
            value={capacityInput}
            onChange={(e) => setCapacityInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-label={t.editCapacity}
          />
          <button className="btn" disabled={capacityInput === ''} onClick={setCapacity}>
            {t.editCapacity}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>{t.incomingHolds}</h2>
        {holds.length === 0 && <p className="muted">{t.noHolds}</p>}
        <ul className="list">
          {holds.map((h) => (
            <li key={h.id} className="row">
              <div className="grow">
                <div className="hold-code">{h.code}</div>
                <div className="small">
                  {t.expiresIn} <Countdown until={h.expireAt} />
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => confirm(h)}>
                {t.confirmArrival}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {toast.node}
    </div>
  );
}
