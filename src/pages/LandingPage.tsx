import { ArrowDown, ArrowRight, BookOpen, Clock3, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function LandingPage() {
  const { demoMode } = useAuth()
  const startPath = demoMode ? '/app' : '/signup'
  const startLabel = demoMode ? 'Explore local demo' : 'Get started'

  return (
    <main className="landing-shell">
      <header className="landing-header">
        <Link to="/" className="wordmark" aria-label="Seema home">seema<span>.</span></Link>
        {demoMode
          ? <span className="demo-badge">Local demo</span>
          : <Link to="/signin" className="landing-signin">Sign in</Link>}
      </header>

      <section className="landing-hero">
        <p className="landing-kicker">For minds that keep wandering</p>
        <h1>That thought you’ll<br />look up <em>later.</em></h1>
        <p className="landing-copy">
          Catch the question, idea, or “I wonder…” before it slips away.
          Seema looks into it and brings you a clear answer, useful resources,
          and all your saved thoughts together in one email.
        </p>
        <div className="landing-actions">
          <Link to={startPath} className="landing-primary">{startLabel} <ArrowRight size={17} /></Link>
          <span>{demoMode ? 'Try the capture flow with sample data in this browser.' : 'Free to start · Sign in with a link sent to your email'}</span>
        </div>
        <a className="landing-scroll-link" href="#how-it-works">See how it works <ArrowDown size={14} /></a>
      </section>

      <section className="landing-section landing-curiosity">
        <div className="landing-section-heading">
          <p className="landing-kicker">A little space for curiosity</p>
          <h2>Not another thing<br />to keep in your head.</h2>
          <p>Some thoughts need an answer now. Others can wait until you have a moment. Seema gives them somewhere to go.</p>
        </div>
        <div className="landing-examples">
          <article><span>01</span><h3>Something to look up</h3><p>Save the name, place, or question you don’t have time to explore.</p></article>
          <article><span>02</span><h3>A concept to understand</h3><p>Get a clear explanation without having to start a new search.</p></article>
          <article><span>03</span><h3>A skill to explore</h3><p>Keep useful resources with the ideas that sparked your interest.</p></article>
        </div>
      </section>

      <section className="landing-section landing-how" id="how-it-works">
        <div className="landing-section-heading">
          <p className="landing-kicker">Simple by design</p>
          <h2>Capture it.<br />Carry on.</h2>
        </div>
        <div className="landing-flow">
          <article>
            <div className="landing-flow-icon"><Search size={18} /></div>
            <h3>Save a thought</h3>
            <p>Type a word or a whole question. That’s all you need to do.</p>
          </article>
          <article>
            <div className="landing-flow-icon"><BookOpen size={18} /></div>
            <h3>We look into it</h3>
            <p>Seema researches the topic and gathers helpful places to learn more.</p>
          </article>
          <article>
            <div className="landing-flow-icon"><Clock3 size={18} /></div>
            <h3>It comes back to you</h3>
            <p>Your thoughts arrive together in a readable email digest the next morning.</p>
          </article>
        </div>
      </section>

      <section className="landing-close">
        <p className="landing-kicker">Make room for what’s on your mind</p>
        <h2>Leave the question here.</h2>
        <p>Get back to what you were doing. We’ll take it from here.</p>
        <Link to={startPath} className="landing-primary">{startLabel} <ArrowRight size={17} /></Link>
      </section>

      <footer className="landing-footer">
        <span>seema. A little more room to think.</span>
        <a href="https://nueldotdev.vercel.app/" target="_blank" rel="noreferrer">By <span>nueldotdev</span></a>
      </footer>
    </main>
  )
}
