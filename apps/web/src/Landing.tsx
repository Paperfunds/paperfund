import { NavLink } from 'react-router-dom';
import { siteConfig } from './site-config.js';

export function PublicHeader() {
  return (
    <header className="public-header">
      <NavLink to="/" className="public-brand" aria-label="Paperfund home">
        <img src="/paperfund-mark-v2.svg" alt="" />
        Paperfund
      </NavLink>
      <nav aria-label="Public navigation">
        <a href="/#how-it-works">How it works</a>
        <a href="/#rewards">Rewards</a>
        <a href="/#payouts">Payouts</a>
        {siteConfig.xUrl && <a href={siteConfig.xUrl} target="_blank" rel="noreferrer">X ↗</a>}
        <a href={siteConfig.githubUrl} target="_blank" rel="noreferrer">GitHub ↗</a>
      </nav>
      <a className="public-enter" href={siteConfig.appUrl + '/trade'}>
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
          <img src="/paperfund-mark-v2.svg" alt="" />
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
        © {new Date().getFullYear()} Paperfund. Trading simulations are independent of live order execution. Simulated
        trading only.
      </p>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="pf2-home">
      <section className="pf2-hero">
        <div className="pf2-container">
          <span className="pf2-kicker">SOLANA PAPER TRADING COMPETITIONS</span>
          <h1>Trade on paper.<span>Compete for SOL.</span></h1>
          <p className="pf2-lead">Real markets. Simulated trades. Hourly and daily competitions with a creator-fee-funded reward model.</p>
          <div className="pf2-actions">
            <a className="pf2-button pf2-primary" href={siteConfig.appUrl + '/trade'}>Enter Paperfund <span aria-hidden="true">↗</span></a>
            <a className="pf2-button pf2-secondary" href="#how-it-works">How it works</a>
          </div>
          <div className="pf2-hero-facts" aria-label="Competition format">
            <div><strong>10 Paper SOL</strong><span>Simulated starting balance</span></div>
            <div><strong>1H / 1D</strong><span>UTC leaderboards</span></div>
            <div><strong>Top 10 / 25</strong><span>Hourly / daily funded places</span></div>
          </div>
        </div>
        <div className="pf2-container">
          <div className="pf2-hero-art">
            <img src="/paperfund-leaderboard-illustration.svg" alt="Illustration of the Paperfund competition leaderboard in its new dark-purple theme" />
            <span className="pf2-art-caption">Design illustration · Not live leaderboard data</span>
          </div>
        </div>
      </section>

      <section className="pf2-section" id="how-it-works">
        <div className="pf2-container">
          <span className="pf2-label">01 / THE IDEA</span>
          <h2>Trade. Compete. Rank.</h2>
          <p className="pf2-subtitle">Trade Solana tokens directly on the Paperfund website. Explore public charts, place simulated orders, and compete without installing a browser extension.</p>
          <div className="pf2-steps">
            <article><span>01 / TRADE</span><h3>Use Paper SOL.</h3><p>Search a Solana token by name or mint, inspect its live market chart, and trade with Paper SOL using server-verified quotes.</p></article>
            <article><span>02 / COMPETE</span><h3>Your P&amp;L sets the rank.</h3><p>Hourly results settle at the UTC cutoff and contribute to daily scores.</p></article>
            <article><span>03 / REWARDS</span><h3>Verified fees fund prizes.</h3><p>Verified creator fees fund the real-SOL reward pool, with payouts made to eligible winners when payments are available.</p></article>
          </div>
        </div>
      </section>

      <section className="pf2-section pf2-product" aria-label="Paperfund website trading">
        <div className="pf2-container pf2-product-grid">
          <div>
            <span className="pf2-label">THE TRADING WORKSPACE</span>
            <h2>One website.<br />Every competition.</h2>
            <p className="pf2-subtitle">Discover markets, view charts, paper trade, track positions and follow hourly or daily rankings in one place. No extension required.</p>
            <a className="pf2-text-link" href={siteConfig.appUrl + '/trade'}>Open the trading workspace ↗</a>
          </div>
          <div className="pf2-product-proof pf-web-preview">
            <div className="pf2-proof-head"><span>PAPERFUND WEB TRADING</span><small>Simple workflow</small></div>
            <div className="pf-web-preview-steps">
              <div><span>01</span><strong>Find a market</strong><small>Search by name, symbol or Solana mint</small></div>
              <div><span>02</span><strong>Inspect its chart</strong><small>Public price history, independent of order pricing</small></div>
              <div><span>03</span><strong>Buy or sell Paper SOL</strong><small>Realistic execution simulation with backend limits</small></div>
              <div><span>04</span><strong>Climb the leaderboard</strong><small>Hourly results also contribute to daily ranking</small></div>
            </div>
            <p>Paper SOL trades are simulated. Reward availability is shown separately on the Rewards page.</p>
          </div>
        </div>
      </section>

      <section className="pf2-section" id="rewards">
        <div className="pf2-container">
          <div className="pf2-split-heading">
            <div><span className="pf2-label">02 / REWARD FUNDING</span><h2>Where the rewards come from.</h2></div>
            <p>Only verified, claimed creator-fee revenue can fund rewards. Platform revenue is accounted for separately.</p>
          </div>
          <div className="pf2-allocation-grid">
            <article className="pf2-allocation-card">
              <div className="pf2-card-head"><strong>Normal mode</strong><span>STANDARD</span></div>
              <div className="pf2-track" aria-label="63 percent hourly, 27 percent daily, 10 percent platform"><span style={{width:'63%'}}/><span style={{width:'27%'}}/><span style={{width:'10%'}}/></div>
              <div className="pf2-values"><div><strong>63%</strong><span>Hourly winners</span></div><div><strong>27%</strong><span>Daily winners</span></div><div><strong>10%</strong><span>Platform</span></div></div>
              <p>The full qualified hourly budget is distributed each hour with eligible winners.</p>
            </article>
            <article className="pf2-allocation-card">
              <div className="pf2-card-head"><strong>Buffer accumulation mode</strong><span>ALTERNATIVE</span></div>
              <div className="pf2-track pf2-buffer-track" aria-label="58 percent hourly, 5 percent buffer, 27 percent daily, 10 percent platform"><span style={{width:'58%'}}/><span style={{width:'5%'}}/><span style={{width:'27%'}}/><span style={{width:'10%'}}/></div>
              <div className="pf2-values"><div><strong>58%</strong><span>Hourly</span></div><div><strong>5%</strong><span>Buffer</span></div><div><strong>27%</strong><span>Daily</span></div><div><strong>10%</strong><span>Platform</span></div></div>
              <p>The buffer portion comes from the hourly allocation; it is not an extra trader fee.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="pf2-section pf2-buffer" id="buffer">
        <div className="pf2-container pf2-buffer-grid">
          <div><span className="pf2-label">03 / REWARD BUFFER</span><h2>A separate buffer.<br />Clear accounting.</h2><p className="pf2-subtitle">A reserve of player-designated funds, governed by the competition rules. It is not platform revenue.</p></div>
          <div className="pf2-buffer-rows">
            <div><strong>Accumulation mode</strong><span>5% of creator fees goes to the reward buffer.</span></div>
            <div><strong>No eligible winners</strong><span>Undistributed player-designated allocation moves to the buffer.</span></div>
            <div><strong>Release requires approval</strong><span>Funds remain recorded and protected until authorized for distribution.</span></div>
          </div>
        </div>
      </section>

      <section className="pf2-section" id="payouts">
        <div className="pf2-container">
          <span className="pf2-label">04 / PAYOUTS</span>
          <h2>From fees to your wallet.</h2>
          <p className="pf2-subtitle">Payouts come from collected creator fees, after competition results and reward funding have been verified.</p>
          <div className="pf2-payout-steps">
            <div><span>01</span><strong>Creator fees claimed</strong><p>Real earned fees become collectable revenue.</p></div>
            <div><span>02</span><strong>Funding verified</strong><p>Accepted receipts are reconciled to competition periods.</p></div>
            <div><span>03</span><strong>Winners finalized</strong><p>Hourly top 10 and daily top 25 are calculated.</p></div>
            <div><span>04</span><strong>Payment verified</strong><p>Completed SOL transfers are recorded on-chain.</p></div>
          </div>
          <div className="pf2-financial-notice"><span aria-hidden="true"/> <strong>Reward transparency.</strong> <span>Track verified funding, allocations and the current payout status on the Rewards page.</span> <a href={siteConfig.appUrl+'/rewards'}>View rewards ↗</a></div>
        </div>
      </section>
    </div>
  );
}
