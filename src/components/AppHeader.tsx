import { ArrowLeft, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function AppHeader({ backTo, backLabel }: { backTo?: string; backLabel?: string }) {
  return (
    <header className="page-header">
      {backTo ? <Link to={backTo} className="back-link"><ArrowLeft size={17} /> {backLabel ?? 'Back'}</Link> : <Link to="/" className="wordmark">seema<span>.</span></Link>}
      {!backTo && <Link to="/settings" className="icon-link" aria-label="Settings"><Settings2 size={19} strokeWidth={1.7} /></Link>}
    </header>
  )
}
