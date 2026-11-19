import { useEffect, useState } from 'react'
import { ArrowUpRight, CircleAlert, MessageCircleQuestion } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { Digest, Capture } from '../lib/types'
import { useAuth } from '../lib/AuthContext'
import { getDemoDigest, markDemoDigestOpened } from '../lib/demo'

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export default function DigestPage() {
  const { demoMode } = useAuth()
  const capturePath = demoMode ? '/app' : '/'
  const { id } = useParams()
  const [digest, setDigest] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      if (demoMode) {
        try {
          const demoDigest = id ? getDemoDigest(id) : null
          if (demoDigest) setDigest(markDemoDigestOpened(demoDigest.id))
          else setError('This demo digest couldn’t be found.')
        } catch (loadError) {
          setError('Local demo digest couldn’t be loaded.')
          console.error('Local demo digest load failed:', loadError)
        }
        setLoading(false)
        return
      }
      if (!supabase || !id) return
      const { data, error: queryError } = await supabase.from('digests')
        .select('id,digest_date,content,created_at,emailed_at,opened_at,reminder_sent_at')
        .eq('id', id)
        .eq('status', 'ready')
        .single()
      if (!active) return
      if (queryError) {
        setError('This digest couldn’t be found.')
        console.error('Digest query failed:', queryError.message)
      } else if (data) {
        const digestData = data as Digest
        setDigest(digestData)
        if (!digestData.opened_at) {
          const { error: updateError } = await supabase.from('digests')
            .update({ opened_at: new Date().toISOString() })
            .eq('id', id)
            .is('opened_at', null)
          if (updateError) {
            setError('Digest opened, but its read status could not be saved.')
            console.error('Digest open tracking failed:', updateError.message)
          }
        }
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [demoMode, id])

  if (loading) return <main className="page-shell"><AppHeader backTo="/digests" backLabel="All digests" /><div className="reader-loading"><span className="loading-dot" /></div></main>
  if (!digest) return <main className="page-shell"><AppHeader backTo="/digests" backLabel="All digests" /><div className="reader-error"><h1>{error || 'Digest not found.'}</h1><Link to="/digests" className="inline-link">Back to your digests <ArrowUpRight size={15} /></Link></div></main>

  const items = (Array.isArray(digest.content) ? digest.content : []) as Capture[]

  return (
    <main className="page-shell reader-shell">
      <AppHeader backTo="/digests" backLabel="All digests" />
      <article className="reader-content">
        <time className="reader-date">{formatDate(digest.digest_date)}</time>
        <h1>Your digest</h1>
        <p className="intro-copy">The topics you saved, researched and ready to read.</p>
        {error && <p className="form-error reader-notice" role="status">{error}</p>}
        <div className="article-divider" />
        {items.map((item, index) => (
          <section className="topic-section" key={item.id}>
            <div className="topic-number">{String(index + 1).padStart(2, '0')}</div>
            <h2>{item.text}</h2>
            {item.status === 'failed' || !item.result ? (
              <div className="research-failed"><CircleAlert size={18} /><p>We couldn’t research this one today. It’s still saved, so you can leave it with us for next time.</p></div>
            ) : (
              <>
                {item.result.explanation && <p className="explanation">{item.result.explanation}</p>}
                {item.result.resources && item.result.resources.length > 0 && (
                  <div className="resources"><h3>A little further</h3>{item.result.resources.map((resource, resourceIndex) => (
                    <a className="resource-link" href={resource.url} target="_blank" rel="noreferrer" key={`${resource.url}-${resourceIndex}`}>
                      <span>{resource.title}{resource.source && <small>{resource.source}</small>}</span><ArrowUpRight size={16} />
                    </a>
                  ))}</div>
                )}
                {item.result.self_test && <div className="self-test"><span>Try this</span><p>{item.result.self_test}</p></div>}
              </>
            )}
            {item.result?.explanation && (
              <Link className="topic-discuss-button digest-discuss-button" to={`/captures/${item.id}/discuss`}>
                <MessageCircleQuestion size={15} /> Discuss this topic
              </Link>
            )}
            {index < items.length - 1 && <div className="topic-divider" />}
          </section>
        ))}
        <div className="reader-endnote"><span>—</span><p>Keep following the questions that find you.</p><Link to={capturePath}>Save another thought <ArrowUpRight size={15} /></Link></div>
      </article>
    </main>
  )
}
