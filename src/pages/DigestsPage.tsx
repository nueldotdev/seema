import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, Mail } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { Digest } from '../lib/types'
import { useAuth } from '../lib/AuthContext'
import { getDemoDigests } from '../lib/demo'

const PAGE_SIZE = 20

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export default function DigestsPage() {
  const { demoMode } = useAuth()
  const capturePath = demoMode ? '/app' : '/'
  const [digests, setDigests] = useState<Digest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      if (demoMode) {
        try {
          const allDigests = getDemoDigests()
          setDigests(allDigests.slice(0, PAGE_SIZE))
          setHasMore(allDigests.length > PAGE_SIZE)
        } catch (loadError) {
          console.error('Local demo digest load failed:', loadError)
          setError('Local demo digests couldn’t be loaded.')
        }
        setLoading(false)
        return
      }
      if (!supabase) return
      const { data, count, error: queryError } = await supabase.from('digests')
        .select('id,digest_date,content,created_at,emailed_at,opened_at,reminder_sent_at', { count: 'exact' })
        .eq('status', 'ready')
        .order('digest_date', { ascending: false })
        .range(0, PAGE_SIZE - 1)
      if (!active) return
      if (queryError) {
        setError('Your digests couldn’t be loaded. Please try again.')
        console.error('Digest list query failed:', queryError.message)
      } else {
        setDigests((data ?? []) as Digest[])
        setHasMore((count ?? 0) > (data?.length ?? 0))
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [demoMode])

  async function loadMore() {
    if (demoMode) {
      const allDigests = getDemoDigests()
      setDigests(allDigests.slice(0, digests.length + PAGE_SIZE))
      setHasMore(allDigests.length > digests.length + PAGE_SIZE)
      return
    }
    if (!supabase) return
    setLoadingMore(true)
    setError('')
    const { data, count, error: queryError } = await supabase.from('digests')
      .select('id,digest_date,content,created_at,emailed_at,opened_at,reminder_sent_at', { count: 'exact' })
      .eq('status', 'ready')
      .order('digest_date', { ascending: false })
      .range(digests.length, digests.length + PAGE_SIZE - 1)
    if (queryError) {
      console.error('Additional digest query failed:', queryError.message)
      setError('More digests couldn’t be loaded. Please try again.')
    } else {
      const nextDigests = (data ?? []) as Digest[]
      setDigests((current) => [...current, ...nextDigests])
      setHasMore((count ?? 0) > digests.length + nextDigests.length)
    }
    setLoadingMore(false)
  }

  return (
    <main className="page-shell">
      <AppHeader backTo="/" backLabel="Capture" />
      <section className="list-content">
        <div className="section-heading-row">
          <h1>Digests</h1>
          <Link className="section-action" to="/history">Browse history <ArrowUpRight size={15} /></Link>
        </div>
        <p className="intro-copy">Your daily reading, with everything researched in one place.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <div className="list-loading"><span className="loading-dot" /></div> : digests.length === 0 ? (
          <div className="empty-state"><div className="empty-icon"><BookOpen size={22} /></div><h2>Nothing to read just yet.</h2><p>Your first digest will appear here after we research something you’ve saved.</p><Link className="inline-link" to={capturePath}>Save a thought <ArrowUpRight size={15} /></Link></div>
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
        {!loading && digests.length > 0 && hasMore && (
          <button className="primary-button load-more-button" type="button" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>
      <footer className="simple-footer"><Link to={capturePath}>Capture a thought <span aria-hidden="true">↗</span></Link></footer>
    </main>
  )
}
