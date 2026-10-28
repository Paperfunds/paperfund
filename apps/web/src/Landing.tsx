import { NavLink } from 'react-router-dom';
import { siteConfig } from './site-config.js';

export function PublicHeader() {
  return (
    <header className="public-header">
      <NavLink to="/" className="public-brand" aria-label="Paperfund home">
        <img src="/paperfund-mark.png" alt="" />
        Paperfund
      </NavLink>
      <nav aria-label="Public navigation">
        <a href="/#how-it-works">How it works</a>
        <a href="/#rewards">Rewards</a>
        <NavLink to="/rules">The rules</NavLink>
      </nav>
      <a className="public-enter" href={siteConfig.appUrl}>
        Enter Paperfund <span>↗</span>
      </a>
    </header>
  );
}
export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div>
        <a className="public-brand" href="/">
          <img src="/paperfund-mark.png" alt="" />
          Paperfund
        </a>
        <p>Practice with purpose.</p>
      </div>
      <div className="footer-links">
        <NavLink to="/rules">Rules</NavLink>
        <NavLink to="/privacy">Privacy</NavLink>
        <NavLink to="/support">Support</NavLink>
        <a href={siteConfig.githubUrl} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
        {siteConfig.xUrl ? (
          <a href={siteConfig.xUrl} target="_blank" rel="noreferrer">
            X / Twitter ↗
          </a>
        ) : (
          <span>X / Twitter · Coming soon</span>
        )}
      </div>
      <p className="footer-disclosure">
        © {new Date().getFullYear()} Paperfund. Independent of Axiom, GMGN.ai and Padre. Simulated
        trading only.
      </p>
    </footer>
  );
}
export function LandingPage() {
  return (
    <div className="league-home">
      <section className="league-hero" aria-labelledby="league-hero-title">
        <div className="league-hero-glow" aria-hidden="true" />
        <div className="league-eyebrow"><span className="league-signal" /> THE SOLANA TRADING LEAGUE</div>
        <h1 id="league-hero-title">The market is real.<br /><span>The trades are not.</span></h1>
        <p className="league-hero-lede">
          Trade on paper. Compete every hour. Earn your position on the leaderboard.
        </p>
        <div className="league-actions">
          <a className="league-cta league-cta-primary" href={siteConfig.appUrl}>
            Enter Paperfund <span aria-hidden="true">↗</span>
          </a>
          <a className="league-cta league-cta-secondary" href={siteConfig.extensionUrl} target="_blank" rel="noreferrer">
            Get the extension <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="league-hero-facts" aria-label="Competition rules">
          <div><strong>10</strong><span>Starting Paper SOL</span></div>
          <div><strong>1H / 1D</strong><span>UTC competitions</span></div>
          <div><strong>5</strong><span>Unique tokens per hour</span></div>
        </div>
        <div className="league-stage" aria-label="Illustration of the Paperfund competition format">
          <div className="league-stage-head">
            <div>
              <span className="league-stage-kicker">THE COMPETITION</span>
              <strong>One hour. One leaderboard.</strong>
            </div>
            <span className="league-stage-pill"><span /> PAPER TRADING</span>
          </div>
          <div className="league-stage-body">
            <div className="league-score">
              <span className="league-stage-kicker">YOUR STARTING BALANCE</span>
              <div className="league-score-value">10.00 <small>PAPER SOL</small></div>
              <p>No deposit. No real-money orders.</p>
              <div className="league-score-bars" aria-hidden="true">
                <span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span />
              </div>
            </div>
            <div className="league-podium">
              <span className="league-stage-kicker">HOW RANKING WORKS</span>
              <div className="league-podium-row"><b>01</b><span>Trade on supported terminals</span><i /></div>
              <div className="league-podium-row"><b>02</b><span>Finish the UTC hour</span><i /></div>
              <div className="league-podium-row"><b>03</b><span>Rank by settled P&amp;L</span><i /></div>
              <small>Illustrative process · Not live results</small>
            </div>
          </div>
        </div>
      </section>

      <section className="league-intro" id="how-it-works">
        <span className="league-eyebrow">THE FORMAT</span>
        <h2>Pure competition.<br /><span>Clear rules.</span></h2>
        <div className="league-feature-grid">
          <article>
            <span className="league-feature-index">01 / TRADE</span>
            <h3>Trade the tokens you know.</h3>
            <p>Use Paperfund alongside Axiom, GMGN and Padre. Positions are simulated with market-based pricing.</p>
          </article>
          <article>
            <span className="league-feature-index">02 / COMPETE</span>
            <h3>Every hour counts.</h3>
            <p>Hourly results settle at the UTC cutoff. Each finalized hour also contributes to the daily leaderboard.</p>
          </article>
          <article>
            <span className="league-feature-index">03 / LIMITS</span>
            <h3>The same rules for everyone.</h3>
            <p>Start with 10 Paper SOL. Five unique tokens per hour. Maximum 20% of portfolio equity per buy.</p>
          </article>
        </div>
      </section>

      <section className="league-championship" id="competitions">
        <div className="league-championship-head">
          <span className="league-eyebrow">COMPETITION MODES</span>
          <h2>Two ways<br />to prove it.</h2>
        </div>
        <div className="league-mode-grid">
          <a className="league-mode" href={siteConfig.appUrl + '/hourly'}>
            <span className="league-feature-index">THE SPRINT</span>
            <span className="league-mode-number">01<span>H</span></span>
            <div><h3>Hourly competition</h3><p>Fresh scoring window. Final P&amp;L decides the rank.</p></div>
            <span className="league-mode-arrow" aria-hidden="true">↗</span>
          </a>
          <a className="league-mode" href={siteConfig.appUrl + '/daily'}>
            <span className="league-feature-index">THE CHAMPIONSHIP</span>
            <span className="league-mode-number">24<span>H</span></span>
            <div><h3>Daily competition</h3><p>Every finalized hourly result adds to your UTC day.</p></div>
            <span className="league-mode-arrow" aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      <section className="league-funding" id="rewards">
        <div>
          <span className="league-eyebrow">REWARDS & TRANSPARENCY</span>
          <h2>Real SOL.<br /><span>Verified funding.</span></h2>
          <p>Reward funding comes from verified creator fees—not paper balances. Payouts require qualified results, received funds and financial authorization.</p>
          <a href={siteConfig.appUrl + '/rewards'} className="league-text-link">
            View funding and payout status <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="league-funding-model">
          <div className="league-funding-top"><span>NORMAL ALLOCATION</span><span>CREATOR FEES</span></div>
          <div className="league-allocation-track" role="img" aria-label="63 percent hourly, 27 percent daily, 10 percent platform">
            <span style={{ width: '63%' }} /><span style={{ width: '27%' }} /><span style={{ width: '10%' }} />
          </div>
          <div className="league-split-list">
            <div><b>63%</b><span>Hourly</span></div>
            <div><b>27%</b><span>Daily</span></div>
            <div><b>10%</b><span>Platform</span></div>
          </div>
          <p>Amounts are not payable unless qualified and funded. The alternate buffer mode is described in the competition rules.</p>
        </div>
      </section>

      <section className="league-outro">
        <span className="league-eyebrow">PAPERFUND</span>
        <h2>Make every trade<br />count.</h2>
        <a className="league-cta league-cta-primary" href={siteConfig.appUrl}>Enter the competition <span aria-hidden="true">↗</span></a>
        <p>Paper trading only. No trading deposits. Reward status is verified separately.</p>
      </section>
    </div>
  );
}
