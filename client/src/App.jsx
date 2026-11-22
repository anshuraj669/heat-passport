import { useEffect, useRef } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Passport from './pages/Passport.jsx';
import Supervisor from './pages/Supervisor.jsx';
import Sms from './pages/Sms.jsx';
import Settings from './pages/Settings.jsx';
import Icon from './components/Icon.jsx';
import { getMyPassport, isNative } from './config.js';
import { api } from './api.js';
import { strings } from './i18n.js';
import { dial, myEmergencyNumber, sendSos } from './emergency.js';
import { onShortcut } from './native.js';

// The app opens straight to the worker's own passport once they have one.
function Start() {
  const mine = getMyPassport();
  return isNative && mine ? <Navigate to={`/passport/${mine}`} replace /> : <Home />;
}

function MyPassport() {
  const mine = getMyPassport();
  return <Navigate to={mine ? `/passport/${mine}` : '/'} replace />;
}

// Always in the header: one tap opens the dialer on the local emergency number.
// In the worker's app it also raises an emergency alert to their supervisor and buddy.
function EmergencyCall() {
  useLocation(); // re-read the number after moving between pages (a passport may have just loaded)
  const mine = getMyPassport();
  const number = myEmergencyNumber();
  const lang = (mine && api.cachedPassport(mine)?.worker?.language) || 'en';
  const t = strings[lang] ?? strings.en;
  return (
    <a href={`tel:${number}`} className="sos-call" aria-label={t.sosTopbar(number)} onClick={() => { if (isNative) sendSos(mine, { lang }); }}>
      <Icon name="phone" size={18} />
      <span className="mono">{number}</span>
    </a>
  );
}

// Long-press shortcuts on the app icon.
function Shortcuts() {
  const navigate = useNavigate();
  // Registered once: re-registering on every page change would replay the launch shortcut.
  const go = useRef(navigate);
  go.current = navigate;
  useEffect(() => {
    const navigate = (to) => go.current(to);
    let stop = () => {};
    onShortcut((action) => {
      const mine = getMyPassport();
      if (action === 'call') {
        // Start the alert before leaving for the dialer: navigating to tel: first drops the request.
        sendSos(mine);
        dial(myEmergencyNumber());
        if (mine) navigate(`/passport/${mine}`);
      } else {
        navigate(mine ? `/passport/${mine}?sick=1` : '/');
      }
    }).then((s) => { stop = s; });
    return () => stop();
  }, []);
  return null;
}

export default function App() {
  return (
    <div className={isNative ? 'app native' : 'app'}>
      <Shortcuts />
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="mark" data-mark="arc" aria-hidden="true" /> Heat Passport
        </Link>
        <div className="topbar-end">
          {!isNative && (
            <nav>
              <NavLink to="/supervisor"><span className="nav-long">Crew dashboard</span><span className="nav-short">Crew</span></NavLink>
              <NavLink to="/sms"><span className="nav-long">Text messages</span><span className="nav-short">Texts</span></NavLink>
            </nav>
          )}
          <EmergencyCall />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Start />} />
          <Route path="/me" element={<MyPassport />} />
          <Route path="/passport/:id" element={<Passport />} />
          <Route path="/supervisor" element={<Supervisor />} />
          <Route path="/sms" element={<Sms />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      {isNative ? (
        <nav className="tabbar" aria-label="Main">
          <NavLink to="/me"><Icon name="passport" size={22} />My passport</NavLink>
          <NavLink to="/supervisor"><Icon name="crew" size={22} />Crew</NavLink>
          <NavLink to="/settings"><Icon name="settings" size={22} />Settings</NavLink>
        </nav>
      ) : (
        <footer className="footer">
          Guidance follows OSHA heat acclimatization recommendations. It does not replace medical advice or an employer's heat illness prevention plan.
        </footer>
      )}
    </div>
  );
}
