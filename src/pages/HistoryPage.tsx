import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { Capture } from '../lib/types'
import { useAuth } from '../lib/AuthContext'
import { getDemoDigests, getDemoResearchedCaptures, getDemoSettings } from '../lib/demo'

const PAGE_SIZE = 25

interface HistoryEntry extends Capture {
  digestId: string | null
  digestDate: string
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function asHistoryEntry(capture: Capture, digestId: string | null, digestDate = capture.created_at.slice(0, 10)): HistoryEntry {
  return { ...capture, digestId, digestDate }
}

async function fetchHistory(search: string, offset: number) {
  if (!supabase) throw new Error('Supabase is not configured')
  let request = supabase.from('captures')
    .select('id,text,status,result,created_at,digest_id', { count: 'exact' })
    .or('status.eq.researched,and(status.eq.failed,digest_id.not.is.null)')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)
  if (search) {
    const pattern = `"%${search.replace(/[\\"]/g, '\\$&')}%"`
    request = request.or(`text.ilike.${pattern},result->>explanation.ilike.${pattern}`)
  }
  const { data, count, error } = await request
  if (error) throw error
  return {
    entries: ((data ?? []) as (Capture & { digest_id: string | null })[])
      .map((capture) => asHistoryEntry(capture, capture.digest_id)),
    count: count ?? 0,
  }
}

export default function HistoryPage() {
  const { demoMode } = useAuth()
  const capturePath = demoMode ? '/app' : '/'
  const [topics, setTopics] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [emailEnabled, setEmailEnabled] = useState(false)

  useEffect(() => {
    let active = true
    async function loadEmailPreference() {
      if (demoMode) {
        try {
          setEmailEnabled(getDemoSettings().email_enabled)
        } catch (preferenceError) {
          console.error('Local demo email preference load failed:', preferenceError)
        }
        return
      }
      if (!supabase) return
      const { data, error: preferenceError } = await supabase.from('settings').select('email_enabled').maybeSingle()
      if (!active) return
      if (preferenceError) {
        console.error('History email preference lookup failed:', preferenceError.message)
      } else {
        setEmailEnabled(data?.email_enabled ?? true)
      }
    }
    void loadEmailPreference()
    return () => { active = false }
  }, [demoMode])

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      setExpandedTopicId(null)
      setVisibleCount(PAGE_SIZE)
      if (demoMode) {
        try {
          const demoTopics = getDemoDigests().flatMap((digest) =>
            (Array.isArray(digest.content) ? digest.content : [])
              .filter((capture): capture is Capture => Boolean(capture && typeof capture.id === 'string' && typeof capture.text === 'string'))
              .map((capture) => asHistoryEntry(capture, digest.id, digest.digest_date)),
          )
          const allTopics = [...demoTopics, ...getDemoResearchedCaptures().map((capture) => asHistoryEntry(capture, null))]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
          if (!active) return
          const normalized = search.toLocaleLowerCase()
          const matching = normalized
            ? allTopics.filter((topic) =>
                topic.text.toLocaleLowerCase().includes(normalized) ||
                topic.result?.explanation?.toLocaleLowerCase().includes(normalized),
              )
            : allTopics
          setTopics(matching)
          setTotalCount(matching.length)
        } catch (loadError) {
          console.error('Local demo history load failed:', loadError)
          setError('Your history couldn’t be loaded.')
        }
        if (active) setLoading(false)
        return
      }

      try {
        const page = await fetchHistory(search, 0)
        if (!active) return
        setTopics(page.entries)
        setTotalCount(page.count)
      } catch (loadError) {
        console.error('History query failed:', loadError)
        setError('Your history couldn’t be loaded. Please try again.')
      }
      if (active) setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [demoMode, search])

  async function loadMore() {
    if (demoMode) {
      setVisibleCount((count) => count + PAGE_SIZE)
      return
    }
    setLoadingMore(true)
    setError('')
    try {
      const page = await fetchHistory(search, topics.length)
      setTopics((current) => [...current, ...page.entries])
      setTotalCount(page.count)
    } catch (loadError) {
      console.error('Additional history query failed:', loadError)
      setError('More history couldn’t be loaded. Please try again.')
    }
    setLoadingMore(false)
  }

  const visibleTopics = useMemo(
    () => demoMode ? topics.slice(0, visibleCount) : topics,
    [demoMode, topics, visibleCount],
  )

  return (
    <main className="page-shell">
      <AppHeader backTo="/" backLabel="Capture" />
      <section className="topics-content">
        <div className="section-heading-row">
          <h1>History</h1>
          <span className="topic-count">{totalCount}</span>
        </div>
        <p className="intro-copy">Everything researched for you, kept in one place.</p>
        <div className="topic-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search topics or explanations"
            aria-label="Search topics or explanations"
          />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <div className="list-loading"><span className="loading-dot" /></div> : visibleTopics.length === 0 ? (
          <div className="empty-state">
            <h2>{query ? 'No topics match that search.' : 'No history yet.'}</h2>
            <p>{query ? 'Try another word or phrase.' : 'Your researched topics will appear here.'}</p>
            {!query && <Link className="inline-link" to={capturePath}>Save a thought <ArrowUpRight size={15} /></Link>}
          </div>
        ) : (
          <>
            <div className="topic-list">
              {visibleTopics.map((topic) => {
                const isExpanded = expandedTopicId === topic.id
                const panelId = `topic-panel-${topic.digestId}-${topic.id}`
                return (
                  <section className={`topic-disclosure${isExpanded ? ' is-expanded' : ''}`} key={topic.id}>
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
                        {emailEnabled && topic.digestId && <Link className="topic-digest-link" to={`/digests/${topic.digestId}`}>Open full digest <ArrowUpRight size={15} /></Link>}
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
            {visibleTopics.length < totalCount && (
              <button className="primary-button load-more-button" type="button" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  )
}
