import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import AuthGate from './components/AuthGate'
import Loading from './components/Loading'
import CapturePage from './pages/CapturePage'
import DigestsPage from './pages/DigestsPage'
import DigestPage from './pages/DigestPage'
import SettingsPage from './pages/SettingsPage'

function AppRoutes() {
  const { session, loading, configured } = useAuth()
  if (loading) return <Loading />
  if (!configured) return <main className="setup-notice"><a className="wordmark" href="/">seema<span>.</span></a><h1>Almost ready.</h1><p>Add your Supabase project URL and anon key to <code>.env.local</code>, then restart the app.</p></main>
  if (!session) return <AuthGate />

  return (
    <Routes>
      <Route path="/" element={<CapturePage />} />
      <Route path="/digests" element={<DigestsPage />} />
      <Route path="/digests/:id" element={<DigestPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
