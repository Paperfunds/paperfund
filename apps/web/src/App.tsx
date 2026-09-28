import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { ApiError, api, errorMessage, type BuyResult, type SellResult } from './api.js';
import {
  formatSol,
  formatUnits,
  lamportsToSolInput,
  percentageQuantity,
  pnlClass,
  shorten,
  solTextToLamports,
  venueName,
} from './format.js';
import type {
  Account,
  HourlyResult,
  LeaderboardEntry,
  MarketSupport,
  Position,
  PositionValuationResponse,
  Round,
  Trade,
  User,
} from './types.js';
import { encodeBase58, getInjectedWallet } from './wallet.js';

type Notice = { tone: 'success' | 'error' | 'info'; title: string; body: ReactNode };

function requestKey(): string {
  return globalThis.crypto.randomUUID();
}

function useAuth() {
  const client = useQueryClient();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
  const connect = useMutation({
    mutationFn: async () => {
      const wallet = getInjectedWallet();
      if (!wallet)
        throw new Error(
          'No compatible Solana wallet was found. Install or enable a browser wallet first.',
        );
      return (await wallet.connect()).publicKey.toString();
    },
    onSuccess: (address) => {
      setWalletAddress(address);
      setWalletError(null);
    },
    onError: (error) => setWalletError(errorMessage(error)),
  });
  const signIn = useMutation({
    mutationFn: async () => {
      const wallet = getInjectedWallet();
      if (!wallet || !walletAddress) throw new Error('Connect your wallet before signing in.');
      const challenge = await api.challenge(walletAddress);
      const signed = await wallet.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
      return (
        await api.verify({ ...challenge, walletAddress, signature: encodeBase58(signed.signature) })
      ).user;
    },
    onSuccess: (user) => {
      client.setQueryData(['session'], user);
      setWalletError(null);
    },
    onError: (error) => setWalletError(errorMessage(error)),
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: async () => {
      client.setQueryData(['session'], null);
      await client.invalidateQueries();
    },
  });
  useEffect(() => {
    const expire = () => client.setQueryData(['session'], null);
    window.addEventListener('paperfund:unauthenticated', expire);
    return () => window.removeEventListener('paperfund:unauthenticated', expire);
  }, [client]);
  return {
    user: session.data ?? null,
    session,
    walletAddress,
    walletError,
    connect,
    signIn,
    logout,
  };
}

function useRound() {
  return useQuery({ queryKey: ['round'], queryFn: api.currentRound, refetchInterval: 4_000 });
}

function useAccount(user: User | null) {
  return useQuery({
    queryKey: ['account', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      try {
        return await api.account();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'ROUND_ACCOUNT_NOT_FOUND') return null;
        throw error;
      }
    },
    refetchInterval: 4_000,
    retry: false,
  });
}

export function App() {
  const auth = useAuth();
  const round = useRound();
  const account = useAccount(auth.user);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const offset = round.data
    ? Date.parse(round.data.serverTime) - (round.dataUpdatedAt || Date.now())
    : 0;
  const serverNow = now + offset;
  const currentRound = round.data?.round ?? null;
  const tradingOpen =
    currentRound?.state === 'OPEN' && serverNow < Date.parse(currentRound.endsAtExclusive);
  const countdown = currentRound
    ? countdownText(Date.parse(currentRound.endsAtExclusive) - serverNow)
    : '--:--';

  useEffect(() => {
    const previous = account.data?.roundId;
    if (previous && currentRound?.id && previous !== currentRound.id) void account.refetch();
  }, [currentRound?.id, account.data?.roundId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="wordmark" to="/" aria-label="Paperfund home">
          <BrandMark />
          <span>Paperfund</span>
        </NavLink>
        <nav aria-label="Primary navigation">
          <NavItem to="/" icon="⌂">
            Home
          </NavItem>
          <NavItem to="/trade" icon="↗">
            Trade
          </NavItem>
          <NavItem to="/hourly" icon="◷">
            Hourly
          </NavItem>
          <NavItem to="/daily" icon="◇">
            Daily
          </NavItem>
          <NavItem to="/history" icon="≡">
            History
          </NavItem>
          <NavItem to="/rules" icon="§">
            Rules
          </NavItem>
        </nav>
        <div className="sidebar-foot">
          <div>
            <span className="status-dot" /> Paper trading only
          </div>
          <div className="legal-links">
            <NavLink to="/privacy">Privacy</NavLink>
            <NavLink to="/support">Support</NavLink>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="mobile-brand">
            <BrandMark /> Paperfund
          </div>
          <div className="round-chip">
            <span>ROUND</span>
            <strong>{currentRound ? roundLabel(currentRound) : 'Unavailable'}</strong>
          </div>
          <div className="timer" aria-label={`${countdown} remaining`}>
            <span>{tradingOpen ? 'CLOSES IN' : 'STATUS'}</span>
            <strong>{tradingOpen ? countdown : (currentRound?.state ?? 'OFFLINE')}</strong>
          </div>
          <div className="top-balance">
            <span>PAPER SOL</span>
            <strong>
              {account.isLoading
                ? '—'
                : account.data
                  ? formatSol(account.data.paperSolLamports, 3)
                  : 'Not entered'}
            </strong>
          </div>
          <WalletControl auth={auth} />
        </header>
        <div className="mobile-nav">
          <NavItem to="/">Home</NavItem>
          <NavItem to="/trade">Trade</NavItem>
          <NavItem to="/hourly">Hourly</NavItem>
          <NavItem to="/daily">Daily</NavItem>
          <NavItem to="/history">History</NavItem>
          <NavItem to="/rules">Rules</NavItem>
        </div>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/trade"
            element={
              <TradePage
                user={auth.user}
                round={currentRound}
                account={account.data ?? null}
                accountLoading={account.isLoading}
                tradingOpen={tradingOpen}
              />
            }
          />
          <Route path="/hourly" element={<HourlyPage />} />
          <Route path="/daily" element={<DailyPage user={auth.user} />} />
          <Route path="/history" element={<HistoryPage user={auth.user} />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function LandingPage() {
  return (
    <PageFrame>
      <section className="welcome launch-landing">
        <BrandMark className="hero-mark" />
        <div className="eyebrow">FREE HOURLY SOLANA PAPER TRADING</div>
        <h1>
          Prove your edge.
          <br />
          <em>Earn real rewards.</em>
        </h1>
        <p>
          Start every UTC hour with 10 Paper SOL, trade simulated Solana markets with realistic
          execution, and compete for creator-fee-funded rewards. Paperfund works on the web and
          alongside Axiom, GMGN.ai, and Terminal.trade.
        </p>
        <div className="launch-actions">
          <NavLink className="button primary" to="/trade">
            Enter Paperfund
          </NavLink>
          <NavLink className="button secondary" to="/rules">
            Read the rules
          </NavLink>
        </div>
        <div className="rule-grid">
          <Rule number="01" title="10 Paper SOL" body="A clean simulated account every hour." />
          <Rule
            number="02"
            title="Realistic fills"
            body="Fees, price impact, and forced settlement."
          />
          <Rule
            number="03"
            title="Real rewards"
            body="Audited allocations funded by creator fees."
          />
        </div>
        <span className="simulation-label">
          Simulated trading only · Paper SOL has no monetary value · No trading deposits
        </span>
      </section>
    </PageFrame>
  );
}

function BrandMark({ className = '' }: { className?: string }) {
  return <img className={`brand-mark ${className}`} src="/paperfund-mark.png" alt="" />;
}

function PrivacyPage() {
  return (
    <PageFrame>
      <PageTitle
        eyebrow="PRIVACY"
        title="Paperfund privacy notice"
        subtitle="Last updated September 28, 2026. This release-candidate notice must receive final legal and operator review before publication."
      />
      <article className="policy-copy">
        <h2>What Paperfund processes</h2>
        <p>
          Paperfund processes your public Solana wallet address, an authentication challenge and its
          explicit message signature, simulated competition entries and trades, balances, positions,
          results, reward allocations, and payout records. On supported terminal pages, the
          extension reads only the current hostname and Solana token mint needed to display the
          matching paper-trading market.
        </p>
        <p>
          Technical records may include timestamps, request route and status, network address, and
          operational errors. Final retention periods remain a pre-publication operator and legal
          review item.
        </p>
        <h2>Browser storage and authentication</h2>
        <p>
          Overlay preferences are stored in <code>chrome.storage.local</code>. The extension keeps
          its opaque authenticated session in <code>chrome.storage.session</code>, which is cleared
          when the browser or extension session ends. The web application uses a server-managed
          session cookie. Authentication proves control of an address; it is not a transaction.
        </p>
        <h2>What Paperfund does not access</h2>
        <p>
          Paperfund does not request seed phrases or private keys, sign transactions, submit swaps,
          or gain custody of wallet funds. Paper SOL and simulated positions have no monetary value.
        </p>
        <h2>Why data is used and where it goes</h2>
        <p>
          Data is used to authenticate users, run and audit the competition, prevent duplicate or
          abusive actions, support operations, and verify approved rewards. It may be processed by
          infrastructure categories required to operate the service: application hosting,
          PostgreSQL-compatible database hosting, Redis-compatible session storage, and Solana RPC
          providers. Paperfund currently has no advertising, referral tracking, third-party
          analytics, or sale of personal data, and does not share data for targeted advertising.
        </p>
        <h2>Questions and requests</h2>
        <p>
          Use the <NavLink to="/support">support page</NavLink> for help or privacy requests. The
          legal entity, privacy contact, jurisdictional rights language, and final retention
          schedule are explicit release gates and must be completed before store submission.
        </p>
      </article>
    </PageFrame>
  );
}

function SupportPage() {
  return (
    <PageFrame>
      <PageTitle
        eyebrow="SUPPORT"
        title="Paperfund support"
        subtitle="Help for the Paperfund web app and multi-terminal extension."
      />
      <article className="policy-copy">
        <h2>Before reporting a problem</h2>
        <p>
          Confirm that the extension is enabled, the current page is a supported Solana token route,
          and the Paperfund API is available. Reload the terminal tab after an extension update.
          Signing in requires only an explicit wallet message signature.
        </p>
        <h2>Report an issue</h2>
        <p>
          Open a report in the{' '}
          <a href="https://github.com/Paperfunds/paperfund/issues">Paperfund issue tracker</a>.
          Never include a seed phrase, private key, session token, or other secret. A monitored
          support email and legal contact remain required before Chrome Web Store submission.
        </p>
      </article>
    </PageFrame>
  );
}

function RulesPage() {
  return (
    <PageFrame>
      <PageTitle
        eyebrow="COMPETITION RULES"
        title="One hour. One account. The same rules for everyone."
        subtitle="Paperfund is a simulated trading competition. Paper SOL and simulated positions have no monetary value."
      />
      <section className="rules-list" aria-label="Competition rules">
        <Rule
          number="01"
          title="Fresh hourly account"
          body="Each UTC hour starts with exactly 10 Paper SOL. Balances and positions never carry forward."
        />
        <Rule
          number="02"
          title="Position controls"
          body="Each buy is capped at 20% of starting capital, and each account can hold at most five open position slots."
        />
        <Rule
          number="03"
          title="Execution model"
          body="Quotes include protocol fees, price impact, slippage controls, and authoritative route validation."
        />
        <Rule
          number="04"
          title="Forced settlement"
          body="When the hour closes, every open position is sold through the same execution engine before ranks finalize."
        />
        <Rule
          number="05"
          title="Hourly and daily ranks"
          body="Hourly rewards use the top 10; daily rewards use the top 25. Competitive ranks preserve ties."
        />
        <Rule
          number="06"
          title="Reward funding"
          body="Rewards are allocated from verified creator-fee proceeds, reviewed, approved, paid, and reconciled on-chain."
        />
      </section>
      <div className="rules-callout">
        Rewards are not guaranteed. Only an approved payout allocation marked paid after on-chain
        verification represents a completed reward.
      </div>
    </PageFrame>
  );
}

function NavItem({ to, icon, children }: { to: string; icon?: string; children: ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
      {icon && <span>{icon}</span>}
      {children}
    </NavLink>
  );
}

function WalletControl({ auth }: { auth: ReturnType<typeof useAuth> }) {
  if (!auth.walletAddress && !auth.user)
    return (
      <button
        className="wallet-button"
        onClick={() => auth.connect.mutate()}
        disabled={auth.connect.isPending}
      >
        Connect Wallet
      </button>
    );
  if (!auth.user)
    return (
      <div className="wallet-area">
        <span className="wallet-address">{shorten(auth.walletAddress!)}</span>
        <button
          className="button primary compact"
          onClick={() => auth.signIn.mutate()}
          disabled={auth.signIn.isPending}
        >
          {auth.signIn.isPending ? 'Signing…' : 'Sign In'}
        </button>
        {auth.walletError && <span className="floating-error">{auth.walletError}</span>}
      </div>
    );
  return (
    <div className="wallet-area">
      <span className="wallet-address authenticated">
        <span className="status-dot" />
        {shorten(auth.user.walletAddress)}
      </span>
      <button
        className="icon-button"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => auth.logout.mutate()}
      >
        ↪
      </button>
    </div>
  );
}

function TradePage({
  user,
  round,
  account,
  accountLoading,
  tradingOpen,
}: {
  user: User | null;
  round: Round | null;
  account: Account | null;
  accountLoading: boolean;
  tradingOpen: boolean;
}) {
  const client = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);
  const enter = useMutation({
    mutationFn: api.enterRound,
    onSuccess: async () => {
      setNotice({
        tone: 'success',
        title: 'Round entered',
        body: 'Your fresh 10 Paper SOL account is ready.',
      });
      await client.invalidateQueries({ queryKey: ['account'] });
    },
    onError: (error) =>
      setNotice({ tone: 'error', title: 'Could not enter', body: errorMessage(error) }),
  });
  const previousResult = useQuery({
    queryKey: ['latest-result', user?.id],
    enabled: Boolean(user),
    queryFn: async () => (await api.results()).items[0] ?? null,
  });
  const valuations = useQuery({
    queryKey: ['positions', user?.id, account?.roundId],
    enabled: Boolean(user && account && account.roundId === round?.id),
    queryFn: api.positions,
    refetchInterval: 12_000,
    retry: false,
  });

  if (!user)
    return (
      <PageFrame>
        <WelcomePanel />
      </PageFrame>
    );
  if (accountLoading)
    return (
      <PageFrame>
        <SkeletonPanel />
      </PageFrame>
    );
  if (!round)
    return (
      <PageFrame>
        <EmptyState
          title="Round unavailable"
          body="The lifecycle worker has not published a current round yet. Paperfund will recover automatically."
        />
      </PageFrame>
    );
  if (account && account.roundId !== round.id)
    return (
      <PageFrame>
        <NoticeCard
          notice={{
            tone: 'info',
            title: 'New round available',
            body: 'Your previous account is never carried forward. Enter the new round to receive a fresh 10 Paper SOL.',
          }}
        />
        {previousResult.data && <RoundComplete result={previousResult.data} />}
        <EnterRound round={round} pending={enter.isPending} onEnter={() => enter.mutate()} />
      </PageFrame>
    );
  if (!account)
    return (
      <PageFrame>
        {previousResult.data && <RoundComplete result={previousResult.data} />}
        <EnterRound round={round} pending={enter.isPending} onEnter={() => enter.mutate()} />
        {notice && <NoticeCard notice={notice} />}
      </PageFrame>
    );

  return (
    <PageFrame>
      {notice && <NoticeCard notice={notice} />}
      <AccountStrip account={account} round={round} valuations={valuations.data} />
      <div className="trade-layout">
        <section className="panel order-panel">
          <PanelHead
            eyebrow="EXECUTION"
            title="Paper trade"
            badge={tradingOpen ? 'MARKET OPEN' : 'CLOSED'}
          />
          <OrderTicket account={account} tradingOpen={tradingOpen} onNotice={setNotice} />
        </section>
        <section className="panel positions-panel">
          <PanelHead
            eyebrow="PORTFOLIO"
            title="Open positions"
            count={(valuations.data?.positions ?? account.positions).length}
          />
          <Positions
            positions={valuations.data?.positions ?? account.positions}
            tradingOpen={tradingOpen}
            onNotice={setNotice}
          />
        </section>
      </div>
      <TradeHistory user={user} />
    </PageFrame>
  );
}

function WelcomePanel() {
  return (
    <section className="welcome">
      <div className="eyebrow">HOURLY SOLANA COMPETITION</div>
      <h1>
        Trade the market.
        <br />
        <em>Risk nothing real.</em>
      </h1>
      <p>
        Connect a Solana wallet, sign one authentication message, and compete with 10 Paper SOL
        every UTC hour.
      </p>
      <div className="rule-grid">
        <Rule number="01" title="10 Paper SOL" body="A fresh simulated balance every round." />
        <Rule
          number="02"
          title="Real execution math"
          body="Price impact and protocol fees included."
        />
        <Rule number="03" title="Hourly reset" body="Every position closes automatically." />
      </div>
      <span className="simulation-label">
        No deposits · No transaction signing · No real trades
      </span>
    </section>
  );
}

function EnterRound({
  round,
  pending,
  onEnter,
}: {
  round: Round;
  pending: boolean;
  onEnter(): void;
}) {
  return (
    <section className="enter-card">
      <div>
        <div className="eyebrow">ROUND {roundLabel(round)}</div>
        <h1>Your next run starts here.</h1>
        <p>Enter with a clean slate. Prior balances and positions never carry over.</p>
        <ul>
          <li>Start with 10 Paper SOL</li>
          <li>Trade up to 5 unique tokens</li>
          <li>Each new buy is capped at 20% of equity</li>
          <li>Positions close automatically at the hourly end</li>
        </ul>
      </div>
      <button
        className="button primary enter-button"
        onClick={onEnter}
        disabled={pending || round.state !== 'OPEN'}
      >
        {pending ? 'Entering…' : 'Enter Round'}
        <span>→</span>
      </button>
    </section>
  );
}

function AccountStrip({
  account,
  round,
  valuations,
}: {
  account: Account;
  round: Round;
  valuations?: PositionValuationResponse | undefined;
}) {
  return (
    <section className="account-strip">
      <Metric label="Available cash" value={formatSol(account.paperSolLamports, 3)} accent />
      <Metric
        label="Portfolio equity"
        value={
          valuations?.portfolioEquityLamports
            ? formatSol(valuations.portfolioEquityLamports, 3)
            : 'Unavailable'
        }
        note="Executable exit value"
      />
      <Metric
        label="Live Paper P&L"
        value={valuations?.livePnlLamports ? signedSol(valuations.livePnlLamports) : 'Unavailable'}
        className={pnlClass(valuations?.livePnlLamports ?? '0')}
        note="Provisional until round close"
      />
      <Metric
        label="Token slots"
        value={`${account.slotsUsed} / ${account.slotLimit}`}
        note={`${account.slotLimit - account.slotsUsed} remaining`}
      />
      <Metric label="Round state" value={round.state} />
    </section>
  );
}

function OrderTicket({
  account,
  tradingOpen,
  onNotice,
}: {
  account: Account;
  tradingOpen: boolean;
  onNotice(notice: Notice): void;
}) {
  const client = useQueryClient();
  const [mint, setMint] = useState('');
  const [checkedMint, setCheckedMint] = useState('');
  const [amount, setAmount] = useState('');
  const market = useQuery({
    queryKey: ['market', checkedMint],
    enabled: checkedMint.length > 0,
    queryFn: () => api.market(checkedMint),
    retry: false,
  });
  const preflight = useQuery({
    queryKey: ['buy-preflight', checkedMint, account.roundId],
    enabled: Boolean(checkedMint && market.data?.supported),
    queryFn: () => api.buyPreflight(checkedMint),
    refetchInterval: 12_000,
    retry: false,
  });
  const buy = useMutation({
    mutationFn: () => api.buy(checkedMint, amount, requestKey()),
    onSuccess: async (result) => {
      onNotice({ tone: 'success', title: 'BUY FILLED', body: <FillSummary result={result} /> });
      setAmount('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['account'] }),
        client.invalidateQueries({ queryKey: ['positions'] }),
        client.invalidateQueries({ queryKey: ['buy-preflight'] }),
        client.invalidateQueries({ queryKey: ['trades'] }),
      ]);
    },
    onError: (error) =>
      onNotice({ tone: 'error', title: 'Buy rejected', body: errorMessage(error) }),
  });
  const exactAmount = solTextToLamports(amount);
  const exactMax = preflight.data?.maxBuyLamports ? BigInt(preflight.data.maxBuyLamports) : null;
  const exceedsMax = exactAmount !== null && exactMax !== null && exactAmount > exactMax;
  const canBuy =
    tradingOpen &&
    market.data?.supported &&
    preflight.data?.valuationStatus === 'AVAILABLE' &&
    preflight.data.marketSupported &&
    preflight.data.slotAvailable &&
    exactMax !== null &&
    exactAmount !== null &&
    exactAmount > 0n &&
    !exceedsMax &&
    !buy.isPending;
  function inspect(event: FormEvent) {
    event.preventDefault();
    setCheckedMint(mint.trim());
  }
  return (
    <div className="ticket">
      <form onSubmit={inspect}>
        <label htmlFor="mint">Token mint</label>
        <div className="input-row">
          <input
            id="mint"
            value={mint}
            onChange={(event) => {
              setMint(event.target.value);
              if (event.target.value.trim() !== checkedMint) setCheckedMint('');
            }}
            placeholder="Paste Solana mint address"
            autoComplete="off"
          />
          <button className="button secondary" disabled={!mint.trim() || market.isFetching}>
            Inspect
          </button>
        </div>
      </form>
      {market.isFetching && <div className="market-status">Loading authoritative market…</div>}
      {market.error && <div className="market-status error">{errorMessage(market.error)}</div>}
      {market.data && <MarketCard market={market.data} />}
      {preflight.isFetching && <div className="market-status">Calculating exact maximum…</div>}
      {preflight.error && (
        <div className="market-status error">{errorMessage(preflight.error)}</div>
      )}
      <div className="divider" />
      <label htmlFor="buy-amount">Paper SOL amount</label>
      <div className="amount-input">
        <input
          id="buy-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
        />
        <span>SOL</span>
      </div>
      <div className="quick-row">
        <button
          disabled={exactMax === null}
          onClick={() => setAmount(lamportsToSolInput(exactMax! / 4n))}
        >
          25%
        </button>
        <button
          disabled={exactMax === null}
          onClick={() => setAmount(lamportsToSolInput(exactMax! / 2n))}
        >
          50%
        </button>
        <button
          disabled={exactMax === null}
          onClick={() => setAmount(lamportsToSolInput(exactMax!))}
        >
          MAX
        </button>
      </div>
      {exceedsMax && <div className="market-status error">Exceeds 20% maximum for this order.</div>}
      <div className="ticket-review">
        <span>Available cash</span>
        <strong>{formatSol(preflight.data?.cashLamports ?? account.paperSolLamports)}</strong>
        <span>Portfolio equity</span>
        <strong>
          {preflight.data?.portfolioEquityLamports
            ? formatSol(preflight.data.portfolioEquityLamports)
            : 'Unavailable'}
        </strong>
        <span>Maximum allowed</span>
        <strong>
          {preflight.data?.maxBuyLamports
            ? formatSol(preflight.data.maxBuyLamports)
            : 'Unavailable'}
        </strong>
        <span>Requested</span>
        <strong>{exactAmount && exactAmount > 0n ? formatSol(exactAmount) : '—'}</strong>
        <span>Current venue</span>
        <strong>{venueName(preflight.data?.protocol ?? market.data?.executionProtocol)}</strong>
        <span>Slots</span>
        <strong>
          {preflight.data ? `${preflight.data.slotsUsed} / ${preflight.data.slotLimit}` : '—'}
        </strong>
        <span>Slot impact</span>
        <strong>
          {preflight.data
            ? preflight.data.targetAlreadyConsumesSlot
              ? 'Existing slot'
              : preflight.data.slotAvailable
                ? 'Uses new slot'
                : 'No slots available'
            : '—'}
        </strong>
      </div>
      <button className="button buy-button" onClick={() => buy.mutate()} disabled={!canBuy}>
        {buy.isPending ? 'Submitting…' : tradingOpen ? 'Buy with Paper SOL' : 'Round closed'}
      </button>
      <p className="fine-print">
        This advisory snapshot uses executable exit values. The server revalues the portfolio
        transactionally before every fill, so the final limit may move.
      </p>
    </div>
  );
}

function MarketCard({ market }: { market: MarketSupport }) {
  return (
    <div className={`market-card ${market.supported ? 'supported' : 'unsupported'}`}>
      <div>
        <span className="status-dot" />
        <strong>{market.supported ? 'Supported market' : 'Unsupported market'}</strong>
        <small>
          {market.supported
            ? market.status === 'MIGRATED_POOL'
              ? 'PumpSwap migrated'
              : 'Pump.fun bonding curve'
            : market.reason}
        </small>
      </div>
      {market.supported && (
        <div className="market-meta">
          <span>{venueName(market.executionProtocol)}</span>
          <span>{market.tokenDecimals} decimals</span>
        </div>
      )}
    </div>
  );
}

function Positions({
  positions,
  tradingOpen,
  onNotice,
}: {
  positions: Position[];
  tradingOpen: boolean;
  onNotice(notice: Notice): void;
}) {
  if (!positions.length)
    return (
      <EmptyState
        title="No active positions"
        body="Inspect a supported mint and place a paper buy to open your first position."
        compact
      />
    );
  return (
    <div className="position-list">
      {positions.map((position) => (
        <PositionRow
          key={position.id}
          position={position}
          tradingOpen={tradingOpen}
          onNotice={onNotice}
        />
      ))}
    </div>
  );
}

function PositionRow({
  position,
  tradingOpen,
  onNotice,
}: {
  position: Position;
  tradingOpen: boolean;
  onNotice(notice: Notice): void;
}) {
  const client = useQueryClient();
  const [quantity, setQuantity] = useState('');
  const sell = useMutation({
    mutationFn: (requested: string) => api.sell(position.mint, requested, requestKey()),
    onSuccess: async (result) => {
      onNotice({
        tone: 'success',
        title: 'SELL FILLED',
        body: <SellSummary result={result} decimals={position.tokenDecimals} />,
      });
      setQuantity('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['account'] }),
        client.invalidateQueries({ queryKey: ['positions'] }),
        client.invalidateQueries({ queryKey: ['buy-preflight'] }),
        client.invalidateQueries({ queryKey: ['trades'] }),
      ]);
    },
    onError: (error) =>
      onNotice({ tone: 'error', title: 'Sell rejected', body: errorMessage(error) }),
  });
  const valid =
    /^[1-9]\d*$/.test(quantity) && BigInt(quantity) <= BigInt(position.tokenQuantityBaseUnits);
  return (
    <article className="position">
      <div className="position-top">
        <div className="token-avatar">{position.mint.slice(0, 2).toUpperCase()}</div>
        <div>
          <strong>{shorten(position.mint, 7)}</strong>
          <small>
            {venueName(position.originProtocol)} entry
            {position.valuation.status === 'AVAILABLE'
              ? ` · ${venueName(position.valuation.currentProtocol)} current`
              : ''}
          </small>
        </div>
        <div className="position-quantity">
          <span>QUANTITY</span>
          <strong>{formatUnits(position.tokenQuantityBaseUnits, position.tokenDecimals, 6)}</strong>
        </div>
      </div>
      <div className="position-stats">
        <div>
          <span>Cost basis</span>
          <strong>{formatSol(position.costBasisPaperSolLamports)}</strong>
        </div>
        <div>
          <span>Executable value</span>
          <strong>
            {position.valuation.status === 'AVAILABLE'
              ? formatSol(position.valuation.executablePaperSolLamports)
              : 'Valuation unavailable'}
          </strong>
        </div>
        <div>
          <span>Unrealized P&amp;L</span>
          <strong
            className={
              position.valuation.status === 'AVAILABLE'
                ? pnlClass(position.valuation.unrealizedPnlLamports)
                : undefined
            }
          >
            {position.valuation.status === 'AVAILABLE'
              ? signedSol(position.valuation.unrealizedPnlLamports)
              : position.valuation.status === 'UNSUPPORTED_ROUTE'
                ? 'Route unavailable'
                : 'Valuation unavailable'}
          </strong>
        </div>
      </div>
      <label className="sr-only" htmlFor={`sell-${position.id}`}>
        Token base units to sell
      </label>
      <input
        id={`sell-${position.id}`}
        className="sell-input"
        inputMode="numeric"
        placeholder="Exact token base units"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />
      <div className="sell-actions">
        <div className="quick-row">
          {([25, 50, 75] as const).map((percent) => (
            <button
              key={percent}
              onClick={() =>
                setQuantity(percentageQuantity(position.tokenQuantityBaseUnits, percent))
              }
            >
              {percent}%
            </button>
          ))}
        </div>
        <button
          className="button secondary"
          disabled={!tradingOpen || !valid || sell.isPending}
          onClick={() => sell.mutate(quantity)}
        >
          Sell
        </button>
        <button
          className="button danger"
          disabled={!tradingOpen || sell.isPending}
          onClick={() => sell.mutate('ALL')}
        >
          Sell All
        </button>
      </div>
    </article>
  );
}

function TradeHistory({ user }: { user: User }) {
  const trades = useInfiniteQuery({
    queryKey: ['trades', user.id],
    queryFn: ({ pageParam }) => api.trades(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const items = trades.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="panel activity-panel">
      <PanelHead eyebrow="LEDGER" title="Trade activity" count={items.length} />
      {trades.isLoading ? (
        <SkeletonRows />
      ) : items.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Mint</th>
                <th>Venue</th>
                <th>Input</th>
                <th>Output</th>
                <th>Fee</th>
                <th>Realized P&L</th>
              </tr>
            </thead>
            <tbody>
              {items.map((trade) => (
                <TradeRow key={trade.id} trade={trade} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No trades yet"
          body="Completed buys, sells, and hourly auto-closes will appear here."
          compact
        />
      )}
      {trades.hasNextPage && (
        <button
          className="button secondary load-more"
          onClick={() => trades.fetchNextPage()}
          disabled={trades.isFetchingNextPage}
        >
          Load more
        </button>
      )}
    </section>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const forced = trade.execution_context === 'FORCED_HOURLY_SETTLEMENT';
  return (
    <tr>
      <td>{utcTime(trade.executed_at)}</td>
      <td>
        <span className={`trade-side ${trade.side.toLowerCase()}`}>
          {forced ? 'AUTO CLOSE' : trade.side}
        </span>
      </td>
      <td className="mono">{shorten(trade.mint_address)}</td>
      <td>{venueName(trade.protocol_id)}</td>
      <td>
        {trade.side === 'BUY'
          ? formatSol(trade.actual_input_lamports ?? trade.quote_lamports)
          : `${trade.base_quantity} base units`}
      </td>
      <td>
        {trade.side === 'SELL'
          ? formatSol(trade.actual_output_lamports ?? trade.quote_lamports)
          : `${trade.base_quantity} base units`}
      </td>
      <td>{formatSol(trade.fee_lamports)}</td>
      <td className={pnlClass(trade.realized_pnl_lamports)}>
        {trade.side === 'SELL' ? signedSol(trade.realized_pnl_lamports) : '—'}
      </td>
    </tr>
  );
}

function HourlyPage() {
  const board = useQuery({
    queryKey: ['hourly'],
    queryFn: api.hourly,
    refetchInterval: 8_000,
    retry: false,
  });
  return (
    <PageFrame>
      <PageTitle
        eyebrow="FINALIZED RESULTS"
        title="Hourly leaderboard"
        subtitle="Final ranks use settled Paper SOL after every position has been closed through the execution engine."
      />
      {board.isLoading ? (
        <SkeletonPanel />
      ) : board.error ? (
        <EmptyState
          title="Round in progress"
          body="The latest hourly leaderboard is not finalized yet. Rankings appear only after forced settlement completes."
        />
      ) : board.data ? (
        <Leaderboard entries={board.data.entries} kind="hourly" />
      ) : (
        <EmptyState
          title="No finalized rounds yet"
          body="The first leaderboard will appear after a round completes and settles."
        />
      )}
    </PageFrame>
  );
}

function DailyPage({ user }: { user: User | null }) {
  const board = useQuery({ queryKey: ['daily'], queryFn: api.daily, refetchInterval: 8_000 });
  const rewards = useQuery({
    queryKey: ['reward-allocations', user?.id],
    queryFn: api.rewardAllocations,
    enabled: Boolean(user),
  });
  const latestDailyReward = rewards.data?.find(
    ({ competitionType }) => competitionType === 'DAILY',
  );
  return (
    <PageFrame>
      <PageTitle
        eyebrow="UTC CHAMPIONSHIP"
        title="Daily leaderboard"
        subtitle="Every finalized hourly gain and loss contributes to the current UTC day's cumulative score."
      />
      {latestDailyReward?.won && (
        <section className="round-complete">
          <div>
            <span className="eyebrow">DAILY REWARD ALLOCATION</span>
            <strong>Rank #{latestDailyReward.competitiveRank}</strong>
          </div>
          <Metric
            label="Reward allocation"
            value={`${formatSol(latestDailyReward.rewardAllocationLamports)} · ${
              latestDailyReward.status === 'PAID'
                ? 'Paid'
                : latestDailyReward.status === 'PROCESSING'
                  ? 'Processing'
                  : latestDailyReward.status === 'APPROVED'
                    ? 'Approved'
                    : latestDailyReward.status === 'FAILED_REVIEW'
                      ? 'Needs review'
                      : 'Pending'
            }`}
          />
        </section>
      )}
      {board.isLoading ? (
        <SkeletonPanel />
      ) : board.data?.entries.length ? (
        <Leaderboard entries={board.data.entries} kind="daily" user={user} />
      ) : (
        <EmptyState
          title="No Daily Championship results yet"
          body="Complete an hourly round to post a score for the current UTC day."
        />
      )}
    </PageFrame>
  );
}

function Leaderboard({
  entries,
  kind,
  user,
}: {
  entries: LeaderboardEntry[];
  kind: 'hourly' | 'daily';
  user?: User | null;
}) {
  return (
    <section className="panel leaderboard">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Trader</th>
              {kind === 'hourly' ? (
                <>
                  <th>Final Paper SOL</th>
                  <th>Hourly P&L</th>
                </>
              ) : (
                <>
                  <th>Cumulative P&L</th>
                  <th>Rounds</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.user_id} className={entry.user_id === user?.id ? 'user-row' : ''}>
                <td>
                  <span className={`rank rank-${entry.rank}`}>{entry.rank}</span>
                  {entry.tied && <small className="tie">T{entry.tieGroupSize}</small>}
                </td>
                <td className="mono">
                  {shorten(entry.wallet_address, 7)}
                  {entry.user_id === user?.id && <span className="you">YOU</span>}
                </td>
                {kind === 'hourly' ? (
                  <>
                    <td>{formatSol(entry.final_settled_balance_lamports!)}</td>
                    <td className={pnlClass(entry.score)}>{signedSol(entry.score)}</td>
                  </>
                ) : (
                  <>
                    <td className={pnlClass(entry.score)}>{signedSol(entry.score)}</td>
                    <td>{entry.completed_hourly_round_count}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Ties keep their competition rank and share the combined funded ordinal allocation.
      </p>
    </section>
  );
}

function HistoryPage({ user }: { user: User | null }) {
  const results = useInfiniteQuery({
    queryKey: ['results', user?.id],
    enabled: Boolean(user),
    queryFn: ({ pageParam }) => api.results(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = results.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <PageFrame>
      <PageTitle
        eyebrow="YOUR RECORD"
        title="Round history"
        subtitle="Final results remain attached to their original UTC hour. New rounds always begin from 10 Paper SOL."
      />
      {!user ? (
        <EmptyState
          title="Sign in to view history"
          body="Connect your wallet and sign in to load finalized personal results."
        />
      ) : results.isLoading ? (
        <SkeletonPanel />
      ) : items.length ? (
        <section className="history-grid">
          {items.map((result) => (
            <ResultCard key={result.id} result={result} />
          ))}
        </section>
      ) : (
        <EmptyState
          title="No finalized rounds yet"
          body="Your settled hourly results will appear here."
        />
      )}
      {results.hasNextPage && (
        <button className="button secondary load-more" onClick={() => results.fetchNextPage()}>
          Load more
        </button>
      )}
    </PageFrame>
  );
}

function RoundComplete({ result }: { result: HourlyResult }) {
  return (
    <section className="round-complete">
      <div>
        <span className="eyebrow">ROUND COMPLETE</span>
        <strong>{roundRange(result.starts_at, result.ends_at_exclusive)}</strong>
      </div>
      <Metric label="Final Paper SOL" value={formatSol(result.final_settled_balance_lamports)} />
      <Metric
        label="Hourly P&L"
        value={signedSol(result.hourly_pnl_lamports)}
        className={pnlClass(result.hourly_pnl_lamports)}
      />
      {result.reward_allocation_lamports !== null &&
        result.reward_allocation_lamports !== undefined && (
          <Metric
            label={`Reward allocation · Rank #${result.reward_rank}`}
            value={`${formatSol(result.reward_allocation_lamports)} · Pending`}
          />
        )}
    </section>
  );
}
function ResultCard({ result }: { result: HourlyResult }) {
  return (
    <article className="result-card">
      <div>
        <span>
          {new Date(result.starts_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <strong>{roundRange(result.starts_at, result.ends_at_exclusive)}</strong>
      </div>
      <Metric label="Final" value={formatSol(result.final_settled_balance_lamports)} />
      <Metric
        label="P&L"
        value={signedSol(result.hourly_pnl_lamports)}
        className={pnlClass(result.hourly_pnl_lamports)}
      />
      {result.reward_allocation_lamports !== null &&
        result.reward_allocation_lamports !== undefined && (
          <Metric
            label={`Reward · Rank #${result.reward_rank}`}
            value={`${formatSol(result.reward_allocation_lamports)} · Pending`}
          />
        )}
    </article>
  );
}

function FillSummary({ result }: { result: BuyResult }) {
  return (
    <span>
      Spent {formatSol(result.actualPaperSolSpentLamports)} · Received{' '}
      {result.tokenQuantityReceivedBaseUnits} base units · {venueName(result.executionProtocol)} ·
      Fee {formatSol(result.feeLamports)}
    </span>
  );
}
function SellSummary({ result, decimals }: { result: SellResult; decimals: number }) {
  return (
    <span>
      Sold {formatUnits(result.tokenAmountSoldBaseUnits, decimals, 6)} · Received{' '}
      {formatSol(result.paperSolCreditedLamports)} · P&L {signedSol(result.realizedPnlLamports)} ·{' '}
      {venueName(result.executionProtocol)}
    </span>
  );
}
function NoticeCard({ notice }: { notice: Notice }) {
  return (
    <div className={`notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <strong>{notice.title}</strong>
      <span>{notice.body}</span>
    </div>
  );
}
function PageFrame({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}
function PageTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}
function PanelHead({
  eyebrow,
  title,
  badge,
  count,
}: {
  eyebrow: string;
  title: string;
  badge?: string;
  count?: number;
}) {
  return (
    <header className="panel-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {badge && (
        <span className="badge">
          <span className="status-dot" />
          {badge}
        </span>
      )}
      {count !== undefined && <span className="count">{count}</span>}
    </header>
  );
}
function Metric({
  label,
  value,
  note,
  accent,
  className = '',
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`metric ${accent ? 'accent' : ''} ${className}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
function Rule({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="rule">
      <span>{number}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
function EmptyState({ title, body, compact }: { title: string; body: string; compact?: boolean }) {
  return (
    <section className={`empty ${compact ? 'compact' : ''}`}>
      <div className="empty-icon">◇</div>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}
function SkeletonPanel() {
  return (
    <div className="panel skeleton-panel">
      <i />
      <i />
      <i />
    </div>
  );
}
function SkeletonRows() {
  return (
    <div className="skeleton-rows">
      <i />
      <i />
      <i />
    </div>
  );
}

function signedSol(value: string): string {
  const amount = BigInt(value);
  return `${amount > 0n ? '+' : ''}${formatSol(amount)}`;
}
function utcTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
}
function roundRange(start: string, end: string): string {
  return `${utcTime(start).slice(0, 5)}–${utcTime(end).slice(0, 5)} UTC`;
}
function roundLabel(round: Round): string {
  return roundRange(round.startsAt, round.endsAtExclusive);
}
function countdownText(milliseconds: number): string {
  if (milliseconds <= 0) return '00:00';
  const seconds = Math.floor(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
