import { ArrowLeft, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

interface AppHeaderProps {
  backTo?: string
  backLabel?: string
  showQueue?: boolean
  showDigests?: boolean
  showTopics?: boolean
}

export default function AppHeader({ backTo, backLabel, showQueue, showDigests, showTopics }: AppHeaderProps) {
  const { demoMode } = useAuth()
  const homePath = demoMode ? '/app' : '/'
  return (
    <header className="page-header">
      {backTo ? <Link to={backTo === '/' && demoMode ? '/app' : backTo} className="back-link"><ArrowLeft size={17} /> {backLabel ?? 'Back'}</Link> : <Link to={homePath} className="wordmark">seema<span>.</span></Link>}
      {!backTo && <nav className="header-actions" aria-label="Main navigation">
        {showQueue && <Link to="/queue">Queue</Link>}
        {showTopics && <Link to="/topics">Topics</Link>}
        {showDigests && <Link to="/digests">Digests</Link>}
        <Link to="/settings" className="icon-link" aria-label="Settings"><Settings2 size={19} strokeWidth={1.7} /></Link>
      </nav>}
      {demoMode && <span className="demo-badge">Local demo</span>}
    </header>
  )
}
