import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, Mail } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { Digest } from '../lib/types'

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export default function DigestsPage() {
  const [digests, setDigests] = useState<Digest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase) return
      const { data, error: queryError } = await supabase.from('digests').select('id,digest_date,content,created_at,emailed_at,opened_at,reminder_sent_at').eq('status', 'ready').order('digest_date', { ascending: false })
      if (!active) return
      if (queryError) {
        setError('Your digests couldn’t be loaded. Please try again.')
        console.error('Digest list query failed:', queryError.message)
      } else setDigests((data ?? []) as Digest[])
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [])

  return (
    <main className="page-shell">
      <AppHeader backTo="/" backLabel="Capture" />
      <section className="list-content">
        <div className="eyebrow"><span className="eyebrow-line" /> Your reading room</div>
        <h1>A few things<br />worth <em>understanding.</em></h1>
        <p className="intro-copy">Each note you leave becomes a little more room to learn.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <div className="list-loading"><span className="loading-dot" /></div> : digests.length === 0 ? (
          <div className="empty-state"><div className="empty-icon"><BookOpen size={22} /></div><h2>Nothing to read just yet.</h2><p>Your first digest will appear here after we research something you’ve saved.</p><Link className="inline-link" to="/">Save a thought <ArrowUpRight size={15} /></Link></div>
        ) : (
          <div className="digest-list">
            {digests.map((digest) => {
              const items = Array.isArray(digest.content) ? digest.content : []
              return (
                <Link to={`/digests/${digest.id}`} className={`digest-card ${digest.opened_at ? '' : 'unread'}`} key={digest.id}>
                  <div className="digest-card-icon"><Mail size={17} /></div>
                  <div className="digest-card-copy">
                    <div className="digest-card-meta"><span>{formatDate(digest.digest_date)}</span>{!digest.opened_at && <span className="unread-label">New</span>}</div>
                    <h2>{items.length === 1 ? items[0].text : `${items.length} things to understand`}</h2>
                    <p>{items.slice(0, 3).map((item) => item.text).join(' · ')}</p>
                  </div>
                  <ArrowUpRight className="digest-arrow" size={18} />
                </Link>
              )
            })}
          </div>
        )}
      </section>
      <footer className="simple-footer"><Link to="/">Save another thought <span aria-hidden="true">↗</span></Link></footer>
    </main>
  )
}
