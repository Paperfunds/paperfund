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
    <>
      <section className="studio-hero">
        <div className="hero-kicker">
          <span className="public-dot" />
          SOLANA PAPER TRADING / HOURLY COMPETITIONS
        </div>
        <h1>
          <span>Prove your edge.</span>
          <br />
          <span className="hero-serif">Keep your capital.</span>
        </h1>
        <div className="hero-bottom">
          <p>
            Your terminals. A fresh start every hour.
            <br />
            Paper trade Solana markets, climb the leaderboard, and build a record that speaks for
            itself.
          </p>
          <div className="hero-buttons">
            <a
              className="studio-button dark"
              href={siteConfig.extensionUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span>↓</span> Get the Chrome extension <span>↗</span>
            </a>
            <a className="studio-text-link" href={siteConfig.appUrl}>
              Enter Paperfund <span>↗</span>
            </a>
          </div>
        </div>
        <div className="hero-footnote">
          No trading deposits. No real-money trades. Just your decisions.
        </div>
      </section>
      <section className="studio-principles" aria-label="Competition at a glance">
        <div>
          <span>01 / START FRESH</span>
          <strong>
            10 <em>Paper SOL</em>
          </strong>
          <p>A new simulated account every UTC hour.</p>
        </div>
        <div>
          <span>02 / FIND YOUR EDGE</span>
          <strong>
            Your <em>familiar terminals.</em>
          </strong>
          <p>Axiom, GMGN.ai, and Terminal / Padre.</p>
        </div>
        <div>
          <span>03 / COMPETE FAIRLY</span>
          <strong>
            One <em>shared rulebook.</em>
          </strong>
          <p>Server-authoritative results. Transparent rewards.</p>
        </div>
      </section>
      <section className="studio-section purpose">
        <div className="section-index">THE IDEA / 01</div>
        <div>
          <h2>
            A place to get better.
            <br />
            <span>Before capital is on the line.</span>
          </h2>
          <p>
            Markets move fast. Learning shouldn’t mean risking your wallet. Paperfund brings a
            structured paper-trading competition into the Solana terminals you already use, with
            simulated execution, clear limits, and a fresh opportunity every hour.
          </p>
          <p>
            Trade through the Paperfund extension on Axiom, GMGN and Padre. Follow the competition
            here. Your Paper SOL is simulated and cannot be withdrawn.
          </p>
        </div>
      </section>
      <section className="studio-section how-section" id="how-it-works">
        <div className="section-index">GET STARTED / 02</div>
        <div>
          <h2>
            Your next hour
            <br />
            <span>starts here.</span>
          </h2>
          <ol className="studio-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Install the extension.</h3>
                <p>
                  Get the published Paperfund extension from the Chrome Web Store. Open a supported
                  Solana market on Axiom, GMGN.ai or Padre.
                </p>
              </div>
              <a
                href={siteConfig.extensionUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Install Paperfund from Chrome Web Store"
              >
                ↗
              </a>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Connect. Sign. Join.</h3>
                <p>
                  Connect a Solana wallet and sign an authentication message. Paperfund never
                  asks for your private key or a trading deposit. Reward eligibility is separate
                  from PAPER competition participation.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Make the hour count.</h3>
                <p>
                  Enter with 10 Paper SOL. Up to five unique token entries per hour; each buy is
                  limited to 20% of current portfolio equity. Follow live standings and your own
                  trade history.
                </p>
              </div>
              <a href={siteConfig.appUrl} aria-label="Enter the Paperfund application">
                ↗
              </a>
            </li>
          </ol>
        </div>
      </section>
      <section className="competition-section">
        <div className="section-index">THE COMPETITION / 03</div>
        <div className="competition-intro">
          <h2>
            Every hour, a reset.
            <br />
            <span>Every day, a bigger picture.</span>
          </h2>
          <p>One competition for the next decision. Another for consistency across the day.</p>
        </div>
        <div className="competition-grid">
          <article>
            <span className="competition-number">
              60<span>MIN</span>
            </span>
            <div>
              <span className="section-index">HOURLY LEADERBOARD</span>
              <h3>A clean slate.</h3>
              <p>
                Every UTC hour starts with 10 Paper SOL. Positions are force-settled at cutoff
                before results become final. The approved reward model allocates to the top 10, with
                ties sharing funded places.
              </p>
              <a href={`${siteConfig.appUrl}/hourly`}>Explore hourly standings ↗</a>
            </div>
          </article>
          <article>
            <span className="competition-number">
              24<span>HRS</span>
            </span>
            <div>
              <span className="section-index">DAILY CHAMPIONSHIP</span>
              <h3>The whole day counts.</h3>
              <p>
                All finalized hourly gains and losses add to your UTC-day score. There is no
                best-hour filter or loss protection. The approved daily reward model allocates to
                the top 25.
              </p>
              <a href={`${siteConfig.appUrl}/daily`}>Explore daily standings ↗</a>
            </div>
          </article>
        </div>
      </section>
      <section className="studio-section rewards-explainer" id="rewards">
        <div className="section-index">THE REWARD MODEL / 04</div>
        <div>
          <h2>
            Paper trades.
            <br />
            <span>A real-SOL reward model.</span>
          </h2>
          <p>
            Paper SOL has no monetary value. Separately, the approved reward model is funded by
            verified actual creator fees from the Paperfund token—not user deposits or estimated
            volume. Rewards depend on verified funding, final results and operator approval.
          </p>
          <div className="allocation-visual" aria-label="Normal mode allocation">
            <div className="allocation-hourly">
              63%<span>Hourly</span>
            </div>
            <div className="allocation-daily">
              27%<span>Daily</span>
            </div>
            <div className="allocation-platform">
              10%<span>Platform</span>
            </div>
          </div>
          <p className="allocation-note">
            Normal mode: 63% hourly / 27% daily / 10% platform. Buffer accumulation mode: 58% hourly
            / 5% reward buffer / 27% daily / 10% platform. The player share remains 90%; buffer
            support is subject to recorded available funds.
          </p>
          <div className="beta-disclosure">
            <span className="public-dot" />
            <div>
              <strong>Real-SOL payouts require verified funding and approval.</strong>
              <p>
                Payouts require verified creator fees, qualified competition results, accepted
                funding and financial authorization. Observations and REVIEW allocations are not
                paid rewards. Follow the actual funding and payment status in the app.
              </p>
            </div>
          </div>
          <a className="studio-text-link" href={`${siteConfig.appUrl}/rewards`}>
            View reward transparency <span>↗</span>
          </a>
        </div>
      </section>
      <section className="studio-faq">
        <div>
          <span className="section-index">GOOD TO KNOW / 05</span>
          <h2>
            Clear rules.
            <br />
            <span>From the start.</span>
          </h2>
          <NavLink className="studio-text-link" to="/rules">
            Read the full rules ↗
          </NavLink>
        </div>
        <div>
          <details>
            <summary>Am I trading real SOL?</summary>
            <p>
              No. Every trade is simulated. Paper SOL and positions have no monetary value and
              cannot be withdrawn. Connecting and signing in authenticates your wallet; it does not
              authorize a swap.
            </p>
          </details>
          <details>
            <summary>Who can join Paperfund?</summary>
            <p>
              Connect a Solana wallet to participate in available paper-trading competitions.
              Reward eligibility and geographic restrictions may apply separately. See the
              Rewards page for verified funding and payout status.
            </p>
          </details>
          <details>
            <summary>What happens at the end of an hour?</summary>
            <p>
              Open positions go through forced settlement. Final settled Paper SOL determines the
              hourly result. Each new hour starts with a fresh account; there are no top-ups or
              balance carryovers.
            </p>
          </details>
          <details>
            <summary>Are rewards guaranteed?</summary>
            <p>
              No. Real-SOL rewards depend on verified creator fees, accepted competition results
              and authorized funding. Observed fees, reviewed allocations, qualified funds,
              reserved funds and verified payments are separate states. Only verified on-chain
              payments are paid rewards.
            </p>
          </details>
        </div>
      </section>
      <section className="studio-final">
        <span className="section-index">YOUR EDGE IS EARNED.</span>
        <h2>Give it an hour.</h2>
        <a className="studio-button dark" href={siteConfig.appUrl}>
          Enter Paperfund <span>↗</span>
        </a>
        <p>Public paper trading · Simulated positions · No deposit</p>
      </section>
    </>
  );
}
