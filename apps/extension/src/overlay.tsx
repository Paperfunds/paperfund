import { useCallback, useEffect, useRef, useState } from 'react';

import {
  formatSol,
  formatUnits,
  lamportsToSolInput,
  percentageQuantity,
  shorten,
  solTextToLamports,
  venueName,
  type Account,
  type BuyPreflight,
  type HourlyResult,
  type MarketSupport,
  type PositionValuationResponse,
  type Round,
  type Trade,
  type User,
} from '@paperfund/shared/browser';

import { ApiError, apiRequest, errorMessage, walletRequest } from './client.js';
import { PAPERFUND_APP_URL } from './config.js';
import type { TerminalTokenState } from './terminal.js';

interface OverlayProps {
  terminal: TerminalTokenState;
  collapsed: boolean;
  onCollapsed(value: boolean): void;
  onDisable(): void;
}

type Notice = { tone: 'success' | 'error' | 'info'; text: string };

export function Overlay({ terminal, collapsed, onCollapsed, onDisable }: OverlayProps) {
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<PositionValuationResponse | null>(null);
  const [market, setMarket] = useState<MarketSupport | null>(null);
  const [preflight, setPreflight] = useState<BuyPreflight | null>(null);
  const [loadedMint, setLoadedMint] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [previousResult, setPreviousResult] = useState<HourlyResult | null>(null);
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(Date.now());
  const mintRef = useRef(terminal.mint);
  mintRef.current = terminal.mint;

  const loadRound = useCallback(async () => {
    const result = await apiRequest('CURRENT_ROUND');
    setRound((previous) => {
      if (previous?.id && result.round?.id && previous.id !== result.round.id) {
        setAccount(null);
        setPositions(null);
        setPreflight(null);
      }
      return result.round;
    });
    setServerOffset(Date.parse(result.serverTime) - Date.now());
  }, []);

  const loadAuthenticated = useCallback(async () => {
    if (!user) return;
    try {
      const [accountResult, positionResult, tradeResult, resultPage] = await Promise.all([
        apiRequest('ACCOUNT').catch((error: unknown) => {
          if (error instanceof ApiError && error.code === 'ROUND_ACCOUNT_NOT_FOUND') return null;
          throw error;
        }),
        apiRequest('POSITIONS').catch((error: unknown) => {
          if (error instanceof ApiError && error.code === 'ROUND_ACCOUNT_NOT_FOUND') return null;
          throw error;
        }),
        apiRequest('TRADES'),
        apiRequest('RESULTS'),
      ]);
      setAccount(accountResult);
      setPositions(positionResult);
      setTrades(tradeResult.items);
      setPreviousResult(resultPage.items[0] ?? null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'UNAUTHENTICATED')) {
        setUser(null);
        setAccount(null);
        setPositions(null);
        setPreflight(null);
        setTrades([]);
      }
      throw error;
    }
  }, [user]);

  const loadMarket = useCallback(
    async (mint: string) => {
      setLoadedMint(null);
      setMarket(null);
      setPreflight(null);
      const supported = await apiRequest('MARKET', { mint });
      if (mintRef.current !== mint) return;
      setMarket(supported);
      if (supported.supported && user && account) {
        const exact = await apiRequest('PREFLIGHT', { mint });
        if (mintRef.current !== mint) return;
        setPreflight(exact);
      }
      if (mintRef.current === mint) setLoadedMint(mint);
    },
    [account, user],
  );

  useEffect(() => {
    void apiRequest('ME')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null));
    void loadRound();
  }, [loadRound]);
  useEffect(() => {
    void loadAuthenticated().catch((error: unknown) =>
      setNotice({ tone: 'error', text: errorMessage(error) }),
    );
  }, [loadAuthenticated]);
  useEffect(() => {
    setAmount('');
    setNotice(null);
    setLoadedMint(null);
    setMarket(null);
    setPreflight(null);
  }, [terminal.mint]);
  useEffect(() => {
    const mint = terminal.mint;
    if (mint)
      void loadMarket(mint).catch((error: unknown) => {
        if (mintRef.current === mint) {
          setLoadedMint(mint);
          setNotice({ tone: 'error', text: errorMessage(error) });
        }
      });
  }, [terminal.mint, loadMarket]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.hidden) return;
      void loadRound();
      void loadAuthenticated();
    }, 4_500);
    const visible = () => {
      if (!document.hidden) {
        void loadRound();
        void loadAuthenticated();
        if (terminal.mint) void loadMarket(terminal.mint);
      }
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [loadAuthenticated, loadMarket, loadRound, terminal.mint]);
  useEffect(() => {
    const poll = window.setInterval(() => {
      if (!document.hidden && terminal.mint) void loadMarket(terminal.mint);
    }, 10_000);
    return () => window.clearInterval(poll);
  }, [loadMarket, terminal.mint]);

  const serverNow = now + serverOffset;
  const open = round?.state === 'OPEN' && serverNow < Date.parse(round.endsAtExclusive);
  const remainingMilliseconds = round ? Date.parse(round.endsAtExclusive) - serverNow : null;
  const countdown = remainingMilliseconds === null ? '--:--' : countdownText(remainingMilliseconds);
  const closingSoon = open && remainingMilliseconds !== null && remainingMilliseconds <= 300_000;
  const currentPosition =
    positions?.positions.find((position) => position.mint === terminal.mint) ??
    account?.positions.find((position) => position.mint === terminal.mint);
  const exactAmount = solTextToLamports(amount);
  const exactMax = preflight?.maxBuyLamports ? BigInt(preflight.maxBuyLamports) : null;
  const tradeReady = terminal.mint !== null && terminal.mint === loadedMint;
  const canBuy =
    tradeReady &&
    open &&
    market?.supported &&
    preflight?.valuationStatus === 'AVAILABLE' &&
    preflight.slotAvailable &&
    exactAmount !== null &&
    exactAmount > 0n &&
    exactMax !== null &&
    exactAmount <= exactMax &&
    !pending;

  async function connect(): Promise<void> {
    setPending('wallet');
    setNotice(null);
    try {
      const result = await walletRequest('CONNECT');
      setWallet(result.walletAddress ?? null);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }
  async function signIn(): Promise<void> {
    if (!wallet) return;
    setPending('sign-in');
    setNotice(null);
    try {
      const challenge = await apiRequest('CHALLENGE', { walletAddress: wallet });
      const signed = await walletRequest('SIGN_AUTH_MESSAGE', challenge.message);
      if (signed.walletAddress !== wallet || !signed.signature)
        throw new Error('The connected wallet changed. Connect again.');
      const verified = await apiRequest('VERIFY', {
        walletAddress: wallet,
        challengeId: challenge.challengeId,
        message: challenge.message,
        signature: signed.signature,
      });
      setUser(verified.user);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }
  async function enter(): Promise<void> {
    setPending('enter');
    try {
      await apiRequest('ENTER_ROUND');
      await loadAuthenticated();
      if (terminal.mint) await loadMarket(terminal.mint);
      setNotice({ tone: 'success', text: 'Round entered. 10 Paper SOL is ready.' });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }
  async function refreshAfterTrade(mint: string): Promise<void> {
    await loadAuthenticated();
    if (mintRef.current === mint) await loadMarket(mint);
  }
  async function buy(): Promise<void> {
    const mint = terminal.mint;
    if (!mint || mint !== loadedMint || !canBuy) return;
    setPending('buy');
    setNotice(null);
    try {
      const result = await apiRequest('BUY', {
        mint,
        paperSol: amount,
        idempotencyKey: crypto.randomUUID(),
      });
      setNotice({
        tone: 'success',
        text: `Bought ${formatUnits(result.tokenQuantityReceivedBaseUnits, market?.tokenDecimals ?? 0)} for ${formatSol(result.actualPaperSolSpentLamports)}.`,
      });
      setAmount('');
      await refreshAfterTrade(mint);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }
  async function sell(quantity: string, label: string): Promise<void> {
    const mint = terminal.mint;
    if (!mint || mint !== loadedMint || !currentPosition || pending) return;
    setPending('sell');
    setNotice(null);
    try {
      const result = await apiRequest('SELL', {
        mint,
        quantity,
        idempotencyKey: crypto.randomUUID(),
      });
      setNotice({
        tone: 'success',
        text: `${label}: received ${formatSol(result.paperSolCreditedLamports)} · realized ${signedSol(result.realizedPnlLamports)}.`,
      });
      await refreshAfterTrade(mint);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      className={`pf-panel ${collapsed ? 'collapsed' : ''}`}
      aria-label="Paperfund paper trading overlay"
    >
      <header className="pf-header">
        <div className="pf-brand">
          <img src={chrome.runtime.getURL('icons/paperfund-mark.png')} alt="" />
          <div>
            <strong>PAPERFUND</strong>
            <small>PAPER TRADING ONLY</small>
          </div>
          <span className="pf-terminal">{terminal.terminal}</span>
        </div>
        <div className="pf-head-actions">
          <button title="Disable overlay" aria-label="Disable overlay" onClick={onDisable}>
            ×
          </button>
          <button
            aria-label={collapsed ? 'Expand Paperfund' : 'Collapse Paperfund'}
            onClick={() => onCollapsed(!collapsed)}
          >
            {collapsed ? '▴' : '▾'}
          </button>
        </div>
      </header>
      {collapsed ? (
        <div className="pf-collapsed">
          <b>{terminal.mint ? shorten(terminal.mint, 4) : 'No token'}</b>
          <span>{open ? countdown : (round?.state ?? 'OFFLINE')}</span>
        </div>
      ) : (
        <>
          <div className="pf-round">
            <div>
              <small>ROUND</small>
              <b>{round ? roundRange(round) : 'Unavailable'}</b>
            </div>
            <div>
              <small>{open ? 'TIME LEFT' : 'STATUS'}</small>
              <b className={closingSoon ? 'urgent' : open ? 'green' : ''}>
                {open ? countdown : (round?.state ?? 'OFFLINE')}
              </b>
            </div>
          </div>
          {notice && (
            <div className={`pf-notice ${notice.tone}`} role="status" aria-live="polite">
              {notice.text}
            </div>
          )}
          {!user ? (
            <div className="pf-auth">
              <p>Simulated Paper SOL only. No deposits or transaction signing.</p>
              {!wallet ? (
                <button
                  className="primary"
                  disabled={Boolean(pending)}
                  onClick={() => void connect()}
                >
                  CONNECT WALLET
                </button>
              ) : (
                <>
                  <span className="pf-wallet">{shorten(wallet)}</span>
                  <button
                    className="primary"
                    disabled={Boolean(pending)}
                    onClick={() => void signIn()}
                  >
                    SIGN IN TO PAPERFUND
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="pf-wallet-row">
                <span className="dot" />
                {shorten(user.walletAddress)}
                <button
                  onClick={() =>
                    void apiRequest('LOGOUT').finally(() => {
                      setUser(null);
                      setAccount(null);
                    })
                  }
                >
                  SIGN OUT
                </button>
              </div>
              {!account || account.roundId !== round?.id ? (
                <div className="pf-enter">
                  {previousResult && (
                    <div className="pf-previous">
                      <small>PREVIOUS ROUND</small>
                      <b>{signedSol(previousResult.hourly_pnl_lamports)}</b>
                    </div>
                  )}
                  <p>
                    <b>10 Paper SOL</b>
                    <br />5 token slots · 20% max per BUY
                    <br />
                    Auto-close at hour end
                  </p>
                  <button
                    className="primary"
                    disabled={!open || Boolean(pending)}
                    onClick={() => void enter()}
                  >
                    ENTER ROUND
                  </button>
                </div>
              ) : (
                <>
                  <div className="pf-metrics">
                    <div>
                      <small>CASH</small>
                      <b>{formatSol(account.paperSolLamports, 2)}</b>
                    </div>
                    <div>
                      <small>EQUITY</small>
                      <b>
                        {positions?.portfolioEquityLamports
                          ? formatSol(positions.portfolioEquityLamports, 2)
                          : 'Unavailable'}
                      </b>
                    </div>
                    <div>
                      <small>SLOTS</small>
                      <b>
                        {account.slotsUsed} / {account.slotLimit}
                      </b>
                    </div>
                  </div>
                  <MarketState
                    terminal={terminal}
                    market={market}
                    loading={terminal.mint !== loadedMint}
                  />
                  {tradeReady && market?.supported && (
                    <div className="pf-ticket">
                      <div className="pf-ticket-meta">
                        <span>
                          Venue <b>{venueName(preflight?.protocol ?? market.executionProtocol)}</b>
                        </span>
                        <span>
                          Slot{' '}
                          <b>{preflight?.requiresNewSlot ? 'New token slot' : 'Existing slot'}</b>
                        </span>
                      </div>
                      <label htmlFor="pf-amount">Paper SOL amount</label>
                      <div className="pf-input">
                        <input
                          id="pf-amount"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                        <span>SOL</span>
                      </div>
                      <div className="pf-quick">
                        <button
                          disabled={exactMax === null}
                          onClick={() =>
                            exactMax !== null && setAmount(lamportsToSolInput(exactMax / 4n))
                          }
                        >
                          25%
                        </button>
                        <button
                          disabled={exactMax === null}
                          onClick={() =>
                            exactMax !== null && setAmount(lamportsToSolInput(exactMax / 2n))
                          }
                        >
                          50%
                        </button>
                        <button
                          disabled={exactMax === null}
                          onClick={() =>
                            exactMax !== null && setAmount(lamportsToSolInput(exactMax))
                          }
                        >
                          MAX
                        </button>
                      </div>
                      <div className="pf-max">
                        <span>Authoritative max</span>
                        <b>{exactMax === null ? 'Unavailable' : formatSol(exactMax)}</b>
                      </div>
                      {exactAmount !== null && exactMax !== null && exactAmount > exactMax && (
                        <div className="pf-inline-error">Exceeds the exact maximum.</div>
                      )}
                      <button className="primary buy" disabled={!canBuy} onClick={() => void buy()}>
                        {pending === 'buy' ? 'SUBMITTING…' : 'BUY · PAPER ONLY'}
                      </button>
                    </div>
                  )}
                  {currentPosition && (
                    <div className="pf-position">
                      <div className="pf-section-title">CURRENT POSITION</div>
                      <div className="pf-position-grid">
                        <span>
                          Quantity
                          <b>
                            {formatUnits(
                              currentPosition.tokenQuantityBaseUnits,
                              currentPosition.tokenDecimals,
                            )}
                          </b>
                        </span>
                        <span>
                          Cost basis<b>{formatSol(currentPosition.costBasisPaperSolLamports)}</b>
                        </span>
                        <span>
                          Executable value
                          <b>
                            {currentPosition.valuation.status === 'AVAILABLE'
                              ? formatSol(currentPosition.valuation.executablePaperSolLamports)
                              : 'Unavailable'}
                          </b>
                        </span>
                        <span>
                          Unrealized P&amp;L
                          <b
                            className={pnlTone(
                              currentPosition.valuation.status === 'AVAILABLE'
                                ? currentPosition.valuation.unrealizedPnlLamports
                                : null,
                            )}
                          >
                            {currentPosition.valuation.status === 'AVAILABLE'
                              ? signedSol(currentPosition.valuation.unrealizedPnlLamports)
                              : 'Unavailable'}
                          </b>
                        </span>
                      </div>
                      <div className="pf-sells">
                        <button
                          disabled={!open || Boolean(pending)}
                          onClick={() =>
                            void sell(
                              percentageQuantity(currentPosition.tokenQuantityBaseUnits, 25),
                              'Sold 25%',
                            )
                          }
                        >
                          25%
                        </button>
                        <button
                          disabled={!open || Boolean(pending)}
                          onClick={() =>
                            void sell(
                              percentageQuantity(currentPosition.tokenQuantityBaseUnits, 50),
                              'Sold 50%',
                            )
                          }
                        >
                          50%
                        </button>
                        <button
                          disabled={!open || Boolean(pending)}
                          onClick={() =>
                            void sell(
                              percentageQuantity(currentPosition.tokenQuantityBaseUnits, 75),
                              'Sold 75%',
                            )
                          }
                        >
                          75%
                        </button>
                        <button
                          className="danger"
                          disabled={!open || Boolean(pending)}
                          onClick={() => void sell('ALL', 'Sold all')}
                        >
                          SELL ALL
                        </button>
                      </div>
                    </div>
                  )}
                  {!currentPosition && tradeReady && market?.supported && (
                    <div className="pf-empty-position">No position in this token.</div>
                  )}
                  <div className="pf-activity">
                    <div className="pf-section-title">RECENT ACTIVITY</div>
                    {trades.length === 0 ? (
                      <p>No trades this round.</p>
                    ) : (
                      trades.slice(0, 8).map((trade) => (
                        <div key={trade.id}>
                          <span className={trade.side === 'BUY' ? 'green' : 'sell'}>
                            {trade.execution_context === 'FORCED_HOURLY_SETTLEMENT'
                              ? 'AUTO CLOSE'
                              : trade.side}
                          </span>
                          <b>{shorten(trade.mint_address, 4)}</b>
                          <time>
                            {new Date(trade.executed_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}
          <a className="pf-open" href={PAPERFUND_APP_URL} target="_blank" rel="noreferrer">
            OPEN PAPERFUND ↗
          </a>
        </>
      )}
    </section>
  );
}

function MarketState({
  terminal,
  market,
  loading,
}: {
  terminal: TerminalTokenState;
  market: MarketSupport | null;
  loading: boolean;
}) {
  if (terminal.status === 'NO_MARKET')
    return <div className="pf-market empty">Open a supported Solana token page.</div>;
  if (terminal.status === 'DETECTION_UNAVAILABLE' || !terminal.mint)
    return <div className="pf-market error">Token detection unavailable</div>;
  if (loading)
    return (
      <div className="pf-market">
        <span>{shorten(terminal.mint)}</span>
        <b>Loading authoritative market…</b>
      </div>
    );
  if (!market?.supported)
    return (
      <div className="pf-market error">
        <span>{shorten(terminal.mint)}</span>
        <b>Not supported by Paperfund yet</b>
      </div>
    );
  return (
    <div className="pf-market">
      <span>{shorten(terminal.mint)}</span>
      <b>{venueName(market.executionProtocol)}</b>
    </div>
  );
}

function signedSol(value: string): string {
  return `${BigInt(value) > 0n ? '+' : ''}${formatSol(value)}`;
}
function pnlTone(value: string | null): string {
  if (value === null || BigInt(value) === 0n) return 'neutral';
  return BigInt(value) > 0n ? 'green' : 'red';
}
function countdownText(milliseconds: number): string {
  if (milliseconds <= 0) return '00:00';
  const seconds = Math.floor(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function roundRange(round: Round): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  };
  return `${new Intl.DateTimeFormat('en-GB', options).format(new Date(round.startsAt))}–${new Intl.DateTimeFormat('en-GB', options).format(new Date(round.endsAtExclusive))} UTC`;
}
