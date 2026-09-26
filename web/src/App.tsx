import { authMode, roleOf, Snowflake, useSession } from './auth';
import { useI18n } from './i18n';
import { useLive } from './live';
import { OpsView } from './views/Ops';
import { OutreachView } from './views/Outreach';
import { ResponderView } from './views/Responder';
import { ShelterView } from './views/Shelter';

export function App() {
  const { t, toggle } = useI18n();
  const { me, signOut } = useSession();
  const { connected, online, snapshot, snapshotIsCached, codeFrost } = useLive();
  const role = roleOf(me);

  const View = { outreach: OutreachView, responder: ResponderView, shelter_admin: ShelterView, city_ops: OpsView }[role];
  const cfPending = codeFrost?.event?.status === 'pending_authorization';
  const cfActive = codeFrost?.event?.status === 'active';

  return (
    <div className={`app role-${role}`}>
      <header className="topbar">
        <div className="brand">
          <Snowflake />
          <span>{t.appName}</span>
        </div>
        <span className={`pill ${connected ? 'pill-on' : 'pill-off'}`}>{connected ? t.live : t.connecting}</span>
        <div className="grow" />
        <span className="who small">
          {me.name} · {t[`role_${role}`]}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={toggle} aria-label="Language">
          {t.language}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>
          {authMode === 'dev' ? t.switchRole : t.signOut}
        </button>
      </header>
      {(!online || !connected) && snapshot && snapshotIsCached && (
        <div className="banner banner-warn">
          {t.offline} {new Date(snapshot.at).toLocaleTimeString()}
        </div>
      )}
      {(cfPending || cfActive) && role !== 'city_ops' && (
        <div className={`banner ${cfActive ? 'banner-info' : 'banner-warn'}`}>
          ❄ {t.codeFrost}: {t[`status_${codeFrost!.event!.status}`]}
        </div>
      )}
      <main className="content">
        <View />
      </main>
    </div>
  );
}
