import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { Digest, Capture } from '../lib/types'
import { useAuth } from '../lib/AuthContext'
import { getDemoDigests } from '../lib/demo'

interface TopicEntry extends Capture {
  digestId: string
  digestDate: string
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export default function TopicsPage() {
  const { demoMode } = useAuth()
  const capturePath = demoMode ? '/app' : '/'
  const [topics, setTopics] = useState<TopicEntry[]>([])
  const [query, setQuery] = useState('')
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      if (demoMode) {
        try {
          const demoTopics = getDemoDigests().flatMap((digest) =>
            (Array.isArray(digest.content) ? digest.content : [])
              .filter((capture): capture is Capture => Boolean(capture && typeof capture.id === 'string' && typeof capture.text === 'string'))
              .map((capture) => ({ ...capture, digestId: digest.id, digestDate: digest.digest_date })),
          )
          setTopics(demoTopics)
        } catch (loadError) {
          console.error('Local demo topic load failed:', loadError)
          setError('Local demo topics couldn’t be loaded.')
        }
        setLoading(false)
        return
      }
      if (!supabase) return
      const { data, error: queryError } = await supabase.from('digests')
        .select('id,digest_date,content')
        .eq('status', 'ready')
        .order('digest_date', { ascending: false })
      if (!active) return
      if (queryError) {
        console.error('Topic explorer query failed:', queryError.message)
        setError('Topics couldn’t be loaded. Please try again.')
      } else {
        const entries = ((data ?? []) as Pick<Digest, 'id' | 'digest_date' | 'content'>[])
          .flatMap((digest) => (Array.isArray(digest.content) ? digest.content : [])
            .filter((capture): capture is Capture => Boolean(capture && typeof capture.id === 'string' && typeof capture.text === 'string'))
            .map((capture) => ({ ...capture, digestId: digest.id, digestDate: digest.digest_date })))
        setTopics(entries)
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [demoMode])

  const filteredTopics = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    if (!search) return topics
    return topics.filter((topic) =>
      topic.text.toLocaleLowerCase().includes(search) ||
      topic.result?.explanation?.toLocaleLowerCase().includes(search),
    )
  }, [topics, query])

  return (
    <main className="page-shell">
      <AppHeader backTo="/" backLabel="Capture" />
      <section className="topics-content">
        <div className="section-heading-row">
          <h1>Topics</h1>
          <span className="topic-count">{topics.length}</span>
        </div>
        <p className="intro-copy">Everything researched for you, kept in one place.</p>
        <div className="topic-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search topics or phrases"
            aria-label="Search topics or phrases"
          />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <div className="list-loading"><span className="loading-dot" /></div> : filteredTopics.length === 0 ? (
          <div className="empty-state">
            <h2>{topics.length ? 'No topics match that search.' : 'No topics yet.'}</h2>
            <p>{topics.length ? 'Try another word or phrase.' : 'Your researched topics will appear here.'}</p>
            {!topics.length && <Link className="inline-link" to={capturePath}>Save a thought <ArrowUpRight size={15} /></Link>}
          </div>
        ) : (
          <div className="topic-list">
            {filteredTopics.map((topic) => {
              const isExpanded = expandedTopicId === topic.id
              const panelId = `topic-panel-${topic.digestId}-${topic.id}`
              return (
              <section className={`topic-disclosure${isExpanded ? ' is-expanded' : ''}`} key={`${topic.digestId}-${topic.id}`}>
                <h2 className="topic-heading">
                  <button
                    className="topic-card"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)}
                  >
                  <div className="topic-card-copy">
                    <span className="topic-card-date">{formatDate(topic.digestDate)}</span>
                    <span className="topic-title">{topic.text}</span>
                  </div>
                  <ChevronDown className="topic-chevron" size={18} aria-hidden="true" />
                  </button>
                </h2>
                <div className="topic-details" id={panelId} role="region" aria-label={`${topic.text} details`} aria-hidden={!isExpanded} inert={!isExpanded}>
                  <div className="topic-details-inner">
                  {topic.status === 'failed' || !topic.result ? (
                    <p className="topic-failed">Research could not be completed for this topic.</p>
                  ) : (
                    <>
                      {topic.result.explanation && <p className="explanation">{topic.result.explanation}</p>}
                      {topic.result.resources && topic.result.resources.length > 0 && (
                        <div className="resources">
                          <h3>A little further</h3>
                          {topic.result.resources.map((resource, index) => (
                            <a className="resource-link" href={resource.url} target="_blank" rel="noreferrer" key={`${resource.url}-${index}`}>
                              <span>{resource.title}{resource.source && <small>{resource.source}</small>}</span>
                              <ArrowUpRight size={16} />
                            </a>
                          ))}
                        </div>
                      )}
                      {topic.result.self_test && <div className="self-test"><span>Try this</span><p>{topic.result.self_test}</p></div>}
                    </>
                  )}
                  <Link className="topic-digest-link" to={`/digests/${topic.digestId}`}>Open full digest <ArrowUpRight size={15} /></Link>
                  </div>
                </div>
              </section>
            )})}
          </div>
        )}
      </section>
    </main>
  )
}
