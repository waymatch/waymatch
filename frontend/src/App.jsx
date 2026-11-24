import React, { useEffect, useState, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';

// Ogni pagina in un chunk separato: la mappa (Leaflet) e i grafici (Recharts), usati solo
// da alcune pagine, non appesantiscono più il caricamento iniziale (login/home).
const Setup = lazy(() => import('./pages/Setup.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const Home = lazy(() => import('./pages/Home.jsx'));
const OfferRide = lazy(() => import('./pages/OfferRide.jsx'));
const FindRide = lazy(() => import('./pages/FindRide.jsx'));
const MyRides = lazy(() => import('./pages/MyRides.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Informazioni = lazy(() => import('./pages/Informazioni.jsx'));
const Rewards = lazy(() => import('./pages/Rewards.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminSedi = lazy(() => import('./pages/admin/AdminSedi.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminRewards = lazy(() => import('./pages/admin/AdminRewards.jsx'));
const AdminContests = lazy(() => import('./pages/admin/AdminContests.jsx'));
const AdminPointRules = lazy(() => import('./pages/admin/AdminPointRules.jsx'));
const AdminApprovals = lazy(() => import('./pages/admin/AdminApprovals.jsx'));
const AdminAuditLog = lazy(() => import('./pages/admin/AdminAuditLog.jsx'));
const AdminDocuments = lazy(() => import('./pages/admin/AdminDocuments.jsx'));
const AdminDeletionRequests = lazy(() => import('./pages/admin/AdminDeletionRequests.jsx'));
const AdminPasswordResets = lazy(() => import('./pages/admin/AdminPasswordResets.jsx'));

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.ruolo)) return <Navigate to="/" replace />;
  return children;
}

function useMarkNotificationFromUrl() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nid = params.get('nid');
    if (!nid) return;
    api.put(`/notifications/${nid}/letta`).catch(() => {});
    params.delete('nid');
    const nuovaQuery = params.toString();
    navigate(`${location.pathname}${nuovaQuery ? `?${nuovaQuery}` : ''}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);
}

function RedirectGuida() {
  const { hash } = useLocation();
  return <Navigate to={`/informazioni${hash}`} replace />;
}

export default function App() {
  const [status, setStatus] = useState(null); // { initialized: bool }
  const { loading: authLoading } = useAuth();
  useMarkNotificationFromUrl();

  useEffect(() => {
    api.get('/setup/status').then(setStatus).catch(() => setStatus({ initialized: true }));
  }, []);

  if (status === null || authLoading) return <FullPageLoader />;

  if (!status.initialized) {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          <Route path="*" element={<Setup onDone={() => setStatus({ initialized: true })} />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<FullPageLoader />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reimposta-password" element={<ResetPassword />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="offri" element={<OfferRide />} />
        <Route path="cerca" element={<FindRide />} />
        <Route path="i-miei-viaggi" element={<MyRides />} />
        <Route path="premi" element={<Rewards />} />
        <Route path="profilo" element={<Profile />} />
        <Route path="informazioni" element={<Informazioni />} />
        <Route path="guida" element={<RedirectGuida />} />
        <Route
          path="report"
          element={<ProtectedRoute roles={['mobility_manager', 'supervisor']}><Reports /></ProtectedRoute>}
        />
        <Route
          path="admin/utenti"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminUsers /></ProtectedRoute>}
        />
        <Route
          path="admin/sedi"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminSedi /></ProtectedRoute>}
        />
        <Route
          path="admin/impostazioni"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminSettings /></ProtectedRoute>}
        />
        <Route
          path="admin/premi"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminRewards /></ProtectedRoute>}
        />
        <Route
          path="admin/contest"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminContests /></ProtectedRoute>}
        />
        <Route
          path="admin/punteggio"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminPointRules /></ProtectedRoute>}
        />
        <Route
          path="admin/approvazioni"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminApprovals /></ProtectedRoute>}
        />
        <Route
          path="admin/log"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminAuditLog /></ProtectedRoute>}
        />
        <Route
          path="admin/documenti"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminDocuments /></ProtectedRoute>}
        />
        <Route
          path="admin/cancellazioni"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminDeletionRequests /></ProtectedRoute>}
        />
        <Route
          path="admin/reset-password"
          element={<ProtectedRoute roles={['mobility_manager']}><AdminPasswordResets /></ProtectedRoute>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
