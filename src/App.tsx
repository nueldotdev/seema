import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import AuthGate from './components/AuthGate'
import Loading from './components/Loading'
import CapturePage from './pages/CapturePage'
import DigestsPage from './pages/DigestsPage'
import DigestPage from './pages/DigestPage'
import SettingsPage from './pages/SettingsPage'
import LandingPage from './pages/LandingPage'
import QueuePage from './pages/QueuePage'
import HistoryPage from './pages/HistoryPage'
import DigestEmailGate from './components/DigestEmailGate'

function AppRoutes() {
  const { session, loading, configured, demoMode } = useAuth()
  if (loading) return <Loading />
  if (demoMode) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<CapturePage />} />
        <Route path="/digests" element={<DigestEmailGate><DigestsPage /></DigestEmailGate>} />
        <Route path="/digests/:id" element={<DigestEmailGate><DigestPage /></DigestEmailGate>} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/topics" element={<Navigate to="/history" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }
  if (!configured) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signin" element={<main className="setup-notice"><a className="wordmark" href="/">seema<span>.</span></a><h1>Almost ready.</h1><p>Add your Supabase project URL and publishable key to <code>.env.local</code>, then restart the app to enable sign-in.</p></main>} />
        <Route path="/signup" element={<Navigate to="/signin" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }
  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signin" element={<AuthGate />} />
        <Route path="/signup" element={<AuthGate />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<CapturePage />} />
      <Route path="/app" element={<Navigate to="/" replace />} />
      <Route path="/signin" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route path="/digests" element={<DigestEmailGate><DigestsPage /></DigestEmailGate>} />
      <Route path="/digests/:id" element={<DigestEmailGate><DigestPage /></DigestEmailGate>} />
      <Route path="/queue" element={<QueuePage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/topics" element={<Navigate to="/history" replace />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
