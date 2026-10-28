import { useChartHistoryMetadata } from './use-chart-history-metadata.js';
import { useViewedValuation } from './use-viewed-valuation.js';
import { historicalTrades } from './trade-history-chart.js';
import { usdAverageEntry } from './chart-usd.js';
import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  formatSol,
  buyPreflightMessage,
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
  type Page,
  type Position,
  type PositionValuationResponse,
  type Round,
  type Trade,
  type User,
} from '@paperfund/shared/browser';

import { ApiError, apiRequest, errorMessage, walletRequest } from './client.js';
import { PAPERFUND_APP_URL } from './config.js';
import type { PanelLayout } from './layout.js';
import { averageEntryPriceText } from './position-price.js';
import { averageEntryFx, fillMarkers, marketCapSol, tokenTradeSummary } from './chart-history.js';
import type { TerminalTokenState } from './terminal.js';
import { operatorDiagnostic } from './diagnostics.js';
import type { ChartMarkers } from './chart-marker.js';

interface OverlayProps {
  terminal: TerminalTokenState;
  layout?: PanelLayout;
  collapsed?: boolean;
  onCollapsed(value: boolean): void;
  onDragStart?(event: ReactPointerEvent<HTMLElement>): void;
  onResizeStart?(event: ReactPointerEvent<HTMLElement>): void;
  onAverageEntryChange?(value: { mint: string; price: string } | null): void;
  onMarkersChange?(value: ChartMarkers | null): void;
  onDisable(): void;
}

type Notice = { tone: 'success' | 'error' | 'info'; text: string };

export function Overlay({
  terminal,
  layout: suppliedLayout,
  collapsed = false,
  onCollapsed,
  onDragStart,
  onResizeStart,
  onAverageEntryChange,
  onMarkersChange,
  onDisable,
}: OverlayProps) {
  const layout = suppliedLayout ?? { x: 14, y: 14, width: 376, height: 660, collapsed };
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const roundScope = useRef<string | undefined>(undefined);
  roundScope.current = round?.id;
  const portfolioReceivedAt = useRef<number | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<PositionValuationResponse | null>(null);
  const [market, setMarket] = useState<MarketSupport | null>(null);
  const [preflight, setPreflight] = useState<BuyPreflight | null>(null);
  const [loadedMint, setLoadedMint] = useState<string | null>(null);
  const [chartMarketContext, setChartMarketContext] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [historyOwnerId, setHistoryOwnerId] = useState<string | null>(null);
  const accountOwner = useRef<string | null>(null);
  const [showTrades, setShowTrades] = useState(true);
  useEffect(() => {
    void chrome.storage.local
      .get({ paperfundTradesVisible: true })
      .then((v) => setShowTrades(v['paperfundTradesVisible'] !== false));
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes['paperfundTradesVisible'])
        setShowTrades(changes['paperfundTradesVisible'].newValue !== false);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [viewedRefresh, setViewedRefresh] = useState(0);
  const [chartAvailable, setChartAvailable] = useState<boolean | null>(null);
  const [chartReason, setChartReason] = useState<string | null>(null);
  const [previousResult, setPreviousResult] = useState<HourlyResult | null>(null);
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [marketIssue, setMarketIssue] = useState<string | null>(null);
  const [refreshIssue, setRefreshIssue] = useState<string | null>(null);
  const readGeneration = useRef(0);
  const authRead = useRef<Promise<void> | null>(null);
  const marketRead = useRef<{
    mint: string;
    promise: Promise<void>;
    controller: AbortController;
  } | null>(null);
  const marketRetry = useRef({ failures: 0, after: 0 });
  const hasAccount = Boolean(account);
  const userId = user?.id;
  const resolvedMint = market?.mint;
  const { metadata: verifiedHistoryMetadata, issue: historyMetadataIssue } = useChartHistoryMetadata(userId, terminal.mint);
  const historyMint = verifiedHistoryMetadata?.mint ?? (chartMarketContext === terminal.mint ? resolvedMint : undefined);
  const historyDecimals = verifiedHistoryMetadata?.tokenDecimals ?? (chartMarketContext === terminal.mint ? market?.tokenDecimals : undefined);
  useEffect(() => {
    for (const position of positions?.positions ?? []) {
      if (position.mint !== resolvedMint) continue;
      operatorDiagnostic('POSITION_VALUATION', {
        mint: position.mint,
        basis: position.costBasisPaperSolLamports,
        realizedPnl: position.realizedPnlLamports,
        valuation: position.valuation,
        exit: position.sellPreflight,
      });
    }
  }, [positions, resolvedMint]);
  useEffect(() => {
    readGeneration.current += 1;
    authRead.current = null;
    setTrades([]);
    setHistoryOwnerId(null);
    accountOwner.current = null;
  }, [userId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setHistoryRevision((value) => value + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setChartAvailable(null);
    setChartReason(null);
    const receive = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.data?.channel === 'paperfund:chart:v1' &&
        event.data.direction === 'STATUS' &&
        event.data.context === terminal.mint &&
        typeof event.data.available === 'boolean'
      ) {
        setChartAvailable(event.data.available);
        setChartReason(typeof event.data.reason === 'string' ? event.data.reason : null);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [terminal.mint]);
  useEffect(() => {
    if (!userId || !historyMint) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const read = async () => {
      attempts++;
      const items: Trade[] = [];
      let cursor: string | null = null;
      const cursors = new Set<string>();
      do {
        const page: Page<Trade> = await apiRequest('TRADES', {
          mint: historyMint,
          ...(cursor ? { cursor } : {}),
        });
        if (!active) return;
        items.push(...page.items.filter((item) => item.mint_address === historyMint));
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('Repeated history cursor');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      if (active) {
        setHistoryOwnerId(userId);
        setTrades(items);
        operatorDiagnostic('HISTORICAL_EXECUTIONS_RETRIEVED', {
          mint: historyMint,
          fillCount: items.length,
        });
        if (
          attempts < 4 &&
          items.some(
            (item) =>
              item.sol_usd_fx?.status === 'UNAVAILABLE' &&
              ['HISTORICAL_FX_NOT_CAPTURED', 'HISTORICAL_FX_ENRICHMENT_PENDING'].includes(
                item.sol_usd_fx.reason,
              ),
          )
        )
          retry = setTimeout(() => {
            void read().catch(() => {
              if (active) setRefreshIssue('Chart history reconnecting…');
            });
          }, 1000);
      }
    };
    void read().catch(() => {
      if (active) setRefreshIssue('Chart history reconnecting…');
    });
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [userId, historyMint, historyRevision]);
  const [now, setNow] = useState(Date.now());
  const mintRef = useRef(terminal.mint);
  const marketRequest = useRef(0);
  if (mintRef.current !== terminal.mint) marketRequest.current += 1;
  mintRef.current = terminal.mint;

  const loadRound = useCallback(async () => {
    const result = await apiRequest('CURRENT_ROUND');
    setRound((previous) => {
      if (previous?.id && result.round?.id && previous.id !== result.round.id) {
        readGeneration.current++;
        authRead.current = null;
        setAccount(null);
        setPositions(null);
        setPreflight(null);
      }
      return result.round;
    });
    setServerOffset(Date.parse(result.serverTime) - Date.now());
  }, []);

  const loadAuthenticated = useCallback(async () => {
    if (!userId) return;
    if (authRead.current) return authRead.current;
    const generation = readGeneration.current;
    const eligible = () => generation === readGeneration.current;
    const failure = (error: unknown) => {
      if (!eligible()) return;
      if (error instanceof ApiError && (error.status === 401 || error.code === 'UNAUTHENTICATED')) {
        setUser(null);
        setAccount(null);
        setPositions(null);
        setPreflight(null);
        setTrades([]);
      }
      setRefreshIssue(
        error instanceof ApiError && (error.status === 401 || error.code === 'UNAUTHENTICATED')
          ? errorMessage(error)
          : 'Account data reconnecting…',
      );
    };
    void apiRequest('RESULTS')
      .then((page) => {
        if (eligible()) setPreviousResult(page.items[0] ?? null);
      })
      .catch(failure);
    const read = () =>
      Promise.allSettled([
        apiRequest('ACCOUNT')
          .then((result) => {
            if (eligible() && (!roundScope.current || result.roundId === roundScope.current)) {
              accountOwner.current = userId;
              setAccount(result);
            }
          })
          .catch((error) => {
            if (eligible() && error instanceof ApiError && error.code === 'ROUND_ACCOUNT_NOT_FOUND')
              setAccount(null);
            else failure(error);
          }),
        apiRequest('POSITIONS')
          .then((result) => {
            if (eligible() && (!roundScope.current || result.roundId === roundScope.current)) {
              portfolioReceivedAt.current = performance.now();
              setPositions(result);
              setRefreshIssue(null);
            }
          })
          .catch((error) => {
            if (eligible() && error instanceof ApiError && error.code === 'ROUND_ACCOUNT_NOT_FOUND')
              setPositions(null);
            else failure(error);
          }),
      ]).then(() => {});
    const promise = read().finally(() => {
      if (authRead.current === promise) authRead.current = null;
    });
    authRead.current = promise;
    return promise;
  }, [userId]);

  useEffect(() => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session' || !('paperfundSessionToken' in changes)) return;
      readGeneration.current++;
      authRead.current = null;
      setViewedRefresh((v) => v + 1);
      setUser(null);
      setAccount(null);
      setPositions(null);
      setTrades([]);
      void apiRequest('ME')
        .then((result) => setUser(result.user))
        .catch(() => setUser(null));
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  const loadMarket = useCallback(
    async (mint: string) => {
      if (mintRef.current !== mint) return;
      if (marketRead.current?.mint === mint) return marketRead.current.promise;
      if (Date.now() < marketRetry.current.after) return;
      const controller = new AbortController();
      const request = ++marketRequest.current;
      const current = () => mintRef.current === mint && marketRequest.current === request;
      const read = async () => {
        try {
          const supported = await apiRequest('MARKET', { mint }, { signal: controller.signal });
          if (!current()) return;
          operatorDiagnostic('MARKET_RESULT', {
            terminal: terminal.terminal,
            context: mint,
            result: supported,
          });
          setMarket(supported);
          setChartMarketContext(mint);
          if (supported.supported && userId && hasAccount) {
            const exact = await apiRequest(
              'PREFLIGHT',
              { mint: supported.mint },
              { signal: controller.signal },
            );
            if (!current()) return;
            setPreflight(exact);
          }
          if (current()) {
            setLoadedMint(mint);
            setMarketIssue(null);
            marketRetry.current = { failures: 0, after: 0 };
          }
        } catch (error) {
          if (!current()) return;
          operatorDiagnostic('MARKET_FAILURE', {
            context: mint,
            reason: error instanceof ApiError ? error.code : 'TRANSPORT_ERROR',
          });
          const failures = marketRetry.current.failures + 1;
          marketRetry.current = {
            failures,
            after: Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)),
          };
          if (
            error instanceof ApiError &&
            [
              'MARKET_STATE_UNAVAILABLE',
              'RPC_UNAVAILABLE',
              'RPC_ERROR',
              'RPC_TIMEOUT',
              'PROTOCOL_DISABLED',
            ].includes(error.code)
          ) {
            setMarketIssue('Market data reconnecting…');
          } else {
            setMarketIssue(errorMessage(error));
          }
        }
      };
      const promise = read().finally(() => {
        if (marketRead.current?.promise === promise) marketRead.current = null;
      });
      marketRead.current = { mint, promise, controller };
      return promise;
    },
    [hasAccount, userId, terminal.terminal],
  );

  useEffect(() => {
    void apiRequest('ME')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null));
    void loadRound().catch(() => setRefreshIssue('Account data reconnecting…'));
  }, [loadRound]);
  useEffect(() => {
    void loadAuthenticated().catch((error: unknown) => setRefreshIssue(errorMessage(error)));
  }, [loadAuthenticated]);
  useEffect(() => {
    setAmount('');
    operatorDiagnostic('TERMINAL_CONTEXT', { terminal: terminal.terminal, context: terminal.mint });
    setNotice(null);
    setLoadedMint(null);
    setMarket(null);
    setChartMarketContext(null);
    setPreflight(null);
    setMarketIssue(null);
    marketRetry.current = { failures: 0, after: 0 };
    marketRead.current?.controller.abort();
    marketRead.current = null;
  }, [terminal.mint]);
  useEffect(() => {
    const mint = terminal.mint;
    if (mint) void loadMarket(mint);
    return () => {
      marketRequest.current += 1;
      marketRead.current?.controller.abort();
      marketRead.current = null;
    };
  }, [terminal.mint, loadMarket]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.hidden) return;
      void loadRound().catch(() => setRefreshIssue('Account data reconnecting…'));
      void loadAuthenticated().catch(() => setRefreshIssue('Account data reconnecting…'));
    }, 4_500);
    const visible = () => {
      if (!document.hidden) {
        void loadRound().catch((error: unknown) => setRefreshIssue(errorMessage(error)));
        void loadAuthenticated().catch((error: unknown) => setRefreshIssue(errorMessage(error)));
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
  const backgroundPosition =
    user && account?.roundId === round?.id
      ? (positions?.positions ?? account?.positions)?.find(
          (p) => p.mint === (market?.mint ?? terminal.mint),
        )
      : undefined;
  const accountPosition = account?.positions.find((p) => p.mint === resolvedMint);
  const viewed = useViewedValuation({
    userId,
    accountId: account && account.roundId === round?.id ? account.accountId : undefined,
    roundId: round?.id,
    mint: resolvedMint,
    endsAt: round ? Date.parse(round.endsAtExclusive) - serverOffset : 0,
    knownRevision: JSON.stringify([
      accountPosition?.id,
      accountPosition?.tokenQuantityBaseUnits,
      accountPosition?.costBasisPaperSolLamports,
      accountPosition?.updatedAt,
    ]),
    refresh: viewedRefresh,
  });
  const viewedFinancial = useRef('');
  useEffect(() => {
    if (!viewed.response || (!viewed.response.revision && viewed.response.status !== 'NOT_HELD'))
      return;
    const signature = JSON.stringify([
      viewed.response.accountId,
      viewed.response.roundId,
      viewed.response.mint,
      viewed.response.revision,
      viewed.response.status === 'NOT_HELD',
    ]);
    if (viewedFinancial.current !== signature) {
      viewedFinancial.current = signature;
      setHistoryRevision((v) => v + 1);
    }
  }, [viewed.response]);
  const currentPosition = viewed.response
    ? (viewed.position ??
      (viewed.response.status === 'UNAVAILABLE' && backgroundPosition
        ? {
            ...backgroundPosition,
            valuation: {
              status: 'UNAVAILABLE' as const,
              reason: viewed.response.reason ?? 'VALUATION_UNAVAILABLE',
              valuedAt: viewed.response.completedAt,
            },
          }
        : undefined))
    : backgroundPosition;
  const averageEntry = currentPosition ? averageEntryPriceText(currentPosition) : null;
  const averageEntryLevel = currentPosition ? averageEntryPriceText(currentPosition, 30) : null;
  const tokenSummary =
    account && resolvedMint
      ? tokenTradeSummary(trades, resolvedMint, account.roundId, currentPosition)
      : null;
  useEffect(() => {
    onAverageEntryChange?.(
      averageEntry && terminal.mint ? { mint: terminal.mint, price: averageEntry } : null,
    );
    return () => onAverageEntryChange?.(null);
  }, [averageEntry, onAverageEntryChange, terminal.mint]);
  const historyPlan = useMemo(
    () => {
      const plan = historicalTrades(
        historyOwnerId === userId ? trades : [],
        userId ?? '',
        historyMint ?? '',
        verifiedHistoryMetadata?.tokenSupplyBaseUnits,
        historyDecimals,
        showTrades,
      );
      plan.diagnostics.metadataReason = historyMetadataIssue ?? (!historyMint ? 'CHART_TOKEN_METADATA_MISSING' : market?.supported === false ? 'MARKET_UNSUPPORTED_HISTORY_AVAILABLE' : 'HISTORY_METADATA_VERIFIED');
      plan.diagnostics.executionSupported = market?.supported ?? false;
      return plan;
    },
    [
      historyOwnerId,
      userId,
      trades,
      historyMint,
      verifiedHistoryMetadata?.tokenSupplyBaseUnits,
      historyDecimals,
      showTrades,
      historyMetadataIssue,
      market?.supported,
    ],
  );
  const gmgnReferences = useMemo(() => {
    if (terminal.terminal !== 'GMGN' || !userId || historyOwnerId !== userId ||
      !terminal.mint || historyMint !== terminal.mint || historyPlan.ownerId !== userId ||
      historyPlan.mint !== historyMint) return null;
    const fills = trades.filter(fill => fill.owner_user_id === userId &&
      fill.mint_address === historyMint && fill.competition_account_id &&
      Number.isFinite(Date.parse(fill.executed_at)));
    const current = account && accountOwner.current === userId && account.roundId === round?.id &&
      (!positions || (positions.accountId === account.accountId && positions.roundId === account.roundId)) && currentPosition?.mint === historyMint &&
      resolvedMint === historyMint ? usdAverageEntry(
        fills.filter(fill => fill.competition_account_id === account.accountId), currentPosition,
        account.roundId, market?.tokenSupplyBaseUnits, market?.tokenDecimals,
      ) : null;
    return { current,
      averages: historyPlan.drawings.filter(drawing => drawing.ownerId === userId && drawing.mint === historyMint &&
        ['BUY_AVG', 'SELL_AVG'].includes(drawing.kind)).slice(-6),
      issues: (historyPlan.diagnostics.unavailableDrawings ?? []).filter(issue =>
        ['BUY_AVG', 'SELL_AVG'].includes(issue.kind)).slice(0, 3),
      fills: fills.sort((a, b) => Date.parse(b.executed_at) - Date.parse(a.executed_at) ||
        a.id.localeCompare(b.id)).slice(0, 6),
    };
  }, [terminal.terminal, terminal.mint, userId, historyOwnerId, historyMint, historyPlan, trades,
    account, round?.id, positions, currentPosition, resolvedMint, market?.tokenSupplyBaseUnits, market?.tokenDecimals]);
  useEffect(() => {
    operatorDiagnostic('HISTORY_DISPLAY_METADATA', { mint: historyMint ?? null,
      reason: historyMetadataIssue ?? (!historyMint ? 'CHART_TOKEN_METADATA_MISSING' : market?.supported === false ? 'MARKET_UNSUPPORTED_HISTORY_AVAILABLE' : 'HISTORY_METADATA_VERIFIED'),
      executionSupported: market?.supported ?? false });
    if (!terminal.mint || !historyMint || (!verifiedHistoryMetadata && chartMarketContext !== terminal.mint)) {
      onMarkersChange?.(null);
      return;
    }
    const markers = fillMarkers(
      userId && historyOwnerId === userId
        ? trades.filter((trade) => trade.mint_address === historyMint)
        : [],
    );
    if (averageEntryLevel && resolvedMint === historyMint && accountOwner.current === userId)
      markers.push({
        id: 'average',
        kind: 'AVERAGE',
        priceSol: averageEntryLevel,
        time: 0,
        ...(account && currentPosition
          ? {
              usdEntry: usdAverageEntry(
                trades,
                currentPosition,
                account.roundId,
                market?.tokenSupplyBaseUnits,
                market?.tokenDecimals,
              ),
            }
          : {}),
        solUsd: account ? averageEntryFx(trades, resolvedMint, account.roundId) : undefined,
        ...(market?.tokenSupplyBaseUnits && market.tokenDecimals !== undefined
          ? {
              marketCapSol:
                marketCapSol(
                  averageEntryLevel,
                  market.tokenSupplyBaseUnits,
                  market.tokenDecimals,
                ) ?? undefined,
            }
          : {}),
      });
    onMarkersChange?.({
      context: terminal.mint,
      mint: historyMint,
      url: terminal.url,
      markers,
      ...(userId ? { ownerId: userId, history: historyPlan } : {}),
      marketBinding: {
        requestedContext: verifiedHistoryMetadata?.requestedContext ?? chartMarketContext!,
        mint: historyMint,
        ...(market?.mint === historyMint && market?.marketId ? { marketId: market.marketId } : {}),
      },
    });
  }, [
    trades,
    historyOwnerId,
    historyPlan,
    averageEntryLevel,
    currentPosition,
    historyMint,
    verifiedHistoryMetadata,
    historyMetadataIssue,
    chartMarketContext,
    market?.supported,
    userId,
    account?.roundId,
    terminal.mint,
    terminal.url,
    resolvedMint,
    market?.tokenSupplyBaseUnits,
    market?.tokenDecimals,
    market?.marketId,
    onMarkersChange,
  ]);
  const exactAmount = solTextToLamports(amount);
  const exactMax = preflight?.maxBuyLamports ? BigInt(preflight.maxBuyLamports) : null;
  const tradeReady = terminal.mint !== null && terminal.mint === loadedMint;
  const sellDisabled = (percent: '25' | '50' | '75' | '100') =>
    !tradeReady ||
    !market?.supported ||
    !open ||
    Boolean(pending) ||
    currentPosition?.sellPreflight?.percentages[percent].executable === false;
  const canBuy =
    tradeReady &&
    open &&
    market?.supported &&
    preflight &&
    (preflight.equityValuationStatus
      ? preflight.equityValuationStatus !== 'UNAVAILABLE' && !preflight.blockingReason
      : preflight.valuationStatus === 'AVAILABLE') &&
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
    setHistoryRevision((value) => value + 1);
    await loadAuthenticated().catch(() => setRefreshIssue('Account data reconnecting…'));
    marketRetry.current = { failures: 0, after: 0 };
    if (mintRef.current === mint)
      await loadMarket(mint).catch(() => setRefreshIssue('Market data reconnecting…'));
  }
  async function buy(): Promise<void> {
    const mint = terminal.mint;
    if (!mint || mint !== loadedMint || !canBuy) {
      setNotice({
        tone: 'error',
        text: 'BUY is unavailable for the current token or account state. Refresh the market before retrying. (BUY_CONTEXT_UNAVAILABLE)',
      });
      return;
    }
    setPending('buy');
    setNotice(null);
    try {
      const result = await apiRequest('BUY', {
        mint: market?.mint ?? mint,
        paperSol: amount,
        idempotencyKey: crypto.randomUUID(),
      });
      readGeneration.current += 1;
      authRead.current = null;
      setViewedRefresh((v) => v + 1);
      if (mintRef.current === mint) {
        setNotice({
          tone: 'success',
          text: `Bought ${formatUnits(result.tokenQuantityReceivedBaseUnits, market?.tokenDecimals ?? 0)} for ${formatSol(result.actualPaperSolSpentLamports)}.`,
        });
        setAmount('');
      }
      await refreshAfterTrade(mint);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }
  async function sell(quantity: string, label: string): Promise<void> {
    const mint = terminal.mint;
    const tradeAccountId = account?.accountId;
    if (!mint || mint !== loadedMint || !market?.supported || !open || !currentPosition || pending)
      return;
    setPending('sell');
    setNotice(null);
    try {
      const result = await apiRequest('SELL', {
        mint: market.mint,
        quantity,
        idempotencyKey: crypto.randomUUID(),
      });
      readGeneration.current += 1;
      authRead.current = null;
      if (
        result.newCashBalanceLamports !== undefined &&
        result.remainingQuantityBaseUnits !== undefined &&
        result.remainingCostBasisLamports !== undefined
      ) {
        setAccount((previous) =>
          previous && previous.accountId === tradeAccountId
            ? {
                ...previous,
                paperSolLamports: result.newCashBalanceLamports!,
                positions: previous.positions.flatMap((position) => {
                  if (position.mint !== result.tokenMint) return [position];
                  if (result.remainingQuantityBaseUnits === '0') return [];
                  const next: Position = {
                    ...position,
                    tokenQuantityBaseUnits: result.remainingQuantityBaseUnits!,
                    costBasisPaperSolLamports: result.remainingCostBasisLamports!,
                    valuation: {
                      status: 'UNAVAILABLE' as const,
                      reason: 'Refreshing after fill',
                      valuedAt: result.executedAt,
                    },
                  };
                  delete next.sellPreflight;
                  return [next];
                }),
              }
            : previous,
        );
        setPositions((previous) => (previous?.accountId === tradeAccountId ? null : previous));
      }
      if (mintRef.current === mint)
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
      className={`pf-panel ${layout.collapsed ? 'collapsed' : ''}`}
      aria-label="Paperfund paper trading overlay"
      style={{
        left: `${layout.x}px`,
        top: `${layout.y}px`,
        width: `${layout.width}px`,
        height: layout.collapsed ? 'auto' : `${layout.height}px`,
      }}
    >
      <header className="pf-header" onPointerDown={onDragStart}>
        <div className="pf-brand">
          <img src={chrome.runtime.getURL('icons/paperfund-mark-v2.svg')} alt="" />
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
            aria-label={layout.collapsed ? 'Expand Paperfund' : 'Collapse Paperfund'}
            onClick={() => onCollapsed(!layout.collapsed)}
          >
            {layout.collapsed ? '▴' : '▾'}
          </button>
        </div>
      </header>
      {layout.collapsed ? (
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
            <div
              className={
                notice.tone === 'success' ? 'pf-trade-summary' : `pf-notice ${notice.tone}`
              }
              role="status"
              aria-live="polite"
            >
              {notice.text}
            </div>
          )}
          {(refreshIssue || (marketIssue && (market?.supported || !user))) && (
            <div className="pf-refresh-status" role="status">
              {refreshIssue ?? (market?.supported ? 'Market data reconnecting…' : marketIssue)}
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
                      setPositions(null);
                      setPreflight(null);
                    })
                  }
                >
                  SIGN OUT
                </button>
              </div>
              {userId && terminal.terminal === 'AXIOM' && (
                <div style={{ padding: '7px 12px', fontSize: 9, color: '#89969b' }}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="Paperfund Trades"
                      checked={showTrades}
                      onChange={(event) => {
                        setShowTrades(event.target.checked);
                        void chrome.storage.local.set({
                          paperfundTradesVisible: event.target.checked,
                        });
                      }}
                    />{' '}
                    Paperfund Trades · latest 3 cycles
                  </label>
                  {showTrades && historyPlan.diagnostics.unavailable.length > 0 && (
                    <div className="pf-inline-error">
                      {(historyPlan.diagnostics.unavailableDrawings ?? [])
                        .slice(0, 3)
                        .map((issue, index) => (
                          <div key={index} title={issue.fillId}>
                            {issue.kind} · {issue.executedAt.slice(11, 19)} UTC · {issue.reason}
                          </div>
                        ))}
                      {historyPlan.diagnostics.unavailableDrawings?.length === 0 &&
                        historyPlan.diagnostics.unavailable.join(' · ')}
                      {(historyPlan.diagnostics.unavailableDrawings?.length ?? 0) > 3 && (
                        <div>More details in chart diagnostics.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {gmgnReferences && (
                <div className="pf-position" aria-label="GMGN Paperfund references">
                  <div className="pf-section-title">Reference values — not chart-aligned</div>
                  <div className="pf-position-grid">
                    {gmgnReferences.current && (
                      <span>PF AVG
                        <b>{gmgnReferences.current.reason
                          ? `Unavailable · ${gmgnReferences.current.reason}`
                          : gmgnReferences.current.marketCapUsd
                            ? `${gmgnReferences.current.marketCapUsd} USD market cap`
                            : 'Unavailable · AUTHORITATIVE_SUPPLY_UNAVAILABLE'}</b>
                      </span>
                    )}
                    {gmgnReferences.averages.map(drawing => (
                      <span key={drawing.id} title={drawing.cycleId}>
                        {drawing.kind === 'BUY_AVG' ? 'PF BUY AVG' : 'PF SELL AVG'} · {new Date(drawing.time * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC
                        <b>{drawing.levelUsd} USD market cap</b>
                      </span>
                    ))}
                  </div>
                  {gmgnReferences.issues.map(issue => (
                    <div className="pf-inline-error" key={`${issue.fillId}:${issue.kind}`}>
                      {issue.kind} · {issue.executedAt.slice(0, 19).replace('T', ' ')} UTC · {issue.reason}
                    </div>
                  ))}
                  {gmgnReferences.fills.length > 0 && (
                    <details>
                      <summary>Recent fills · latest 6</summary>
                      <div className="pf-position-grid">
                        {gmgnReferences.fills.map(fill => {
                          const amount = fill.side === 'BUY' ? fill.actual_input_lamports : fill.actual_output_lamports;
                          return <span key={fill.id} title={fill.id}>
                            {fill.side} · {fill.executed_at.slice(0, 19).replace('T', ' ')} UTC
                            <b>{amount && /^\d+$/.test(amount) ? formatSol(amount) : 'Unavailable'}</b>
                          </span>;
                        })}
                      </div>
                    </details>
                  )}
                  {!gmgnReferences.current && gmgnReferences.fills.length === 0 && (
                    <div className="pf-refresh-status">No saved reference values for this token.</div>
                  )}
                </div>
              )}
              {!account && viewed.position && (
                <div className="pf-token-summary" aria-label="Live holding while account refreshes">
                  <span>
                    Holding Value{' '}
                    <b>
                      {viewed.position.valuation.status === 'AVAILABLE'
                        ? formatSol(viewed.position.valuation.executablePaperSolLamports)
                        : 'Unavailable'}
                    </b>
                  </span>
                  <span>
                    Unrealized P&L{' '}
                    <b>
                      {viewed.position.valuation.status === 'AVAILABLE'
                        ? signedSol(viewed.position.valuation.unrealizedPnlLamports)
                        : 'Unavailable'}
                    </b>
                  </span>
                  {viewed.stale && (
                    <small>
                      Last known ·{' '}
                      {viewed.ageMs === null
                        ? 'Unavailable'
                        : `${(viewed.ageMs / 1000).toFixed(1)}s old`}
                    </small>
                  )}
                </div>
              )}
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
                      {positions && portfolioReceivedAt.current !== null && (
                        <small>
                          Portfolio update{' '}
                          {Math.max(
                            0,
                            (performance.now() - portfolioReceivedAt.current) / 1000,
                          ).toFixed(1)}
                          s ago
                        </small>
                      )}
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
                    issue={market?.supported ? null : marketIssue}
                  />
                  {tradeReady && market?.supported && (
                    <div className="pf-ticket">
                      {tokenSummary && (
                        <div className="pf-token-summary" aria-label="Current round token summary">
                          <div>
                            <small>Bought</small>
                            <b>
                              {tokenSummary.bought === null
                                ? 'Unavailable'
                                : `${formatSol(tokenSummary.bought.toString())} SOL`}
                            </b>
                          </div>
                          <div>
                            <small>Sold</small>
                            <b>
                              {tokenSummary.sold === null
                                ? 'Unavailable'
                                : `${formatSol(tokenSummary.sold.toString())} SOL`}
                            </b>
                          </div>
                          <div>
                            <small>Holding Value</small>
                            <b>
                              {tokenSummary.holdingValue === null
                                ? 'Unavailable'
                                : `${formatSol(tokenSummary.holdingValue.toString())} SOL`}
                            </b>
                          </div>
                          <div>
                            <small>P&L</small>
                            <b className={pnlTone(tokenSummary.pnl?.toString() ?? null)}>
                              {tokenSummary.pnl === null
                                ? 'Unavailable'
                                : `${signedSol(tokenSummary.pnl.toString())} SOL${tokenSummary.bought === null ? '' : ` (${pnlPercent(tokenSummary.pnl.toString(), tokenSummary.bought.toString())})`}`}
                            </b>
                          </div>
                        </div>
                      )}
                      {(viewed.stale || !viewed.response) && currentPosition && (
                        <div className="pf-inline-error" role="status">
                          {viewed.ageMs === null
                            ? 'Live valuation unavailable / refreshing'
                            : `Last known valuation · ${(viewed.ageMs / 1000).toFixed(1)}s old`}{' '}
                          · {viewed.response?.reason ?? 'Refresh pending'}
                        </div>
                      )}
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
                      {buyPreflightMessage(preflight) && (
                        <div className="pf-inline-error">{buyPreflightMessage(preflight)}</div>
                      )}
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
                      {averageEntry && (
                        <div className="pf-average-entry" aria-label="Paperfund average entry">
                          <span>PF AVG ENTRY</span>
                          <b>{averageEntry} Paper SOL</b>
                        </div>
                      )}
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
                      </div>
                      <div className="pf-sells">
                        <button
                          disabled={sellDisabled('25')}
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
                          disabled={sellDisabled('50')}
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
                          disabled={sellDisabled('75')}
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
                          disabled={sellDisabled('100')}
                          onClick={() => void sell('ALL', 'Sold all')}
                        >
                          SELL ALL
                        </button>
                      </div>
                      {currentPosition.sellPreflight &&
                        currentPosition.sellPreflight.status !== 'FULL' && (
                          <div className="pf-inline-error">
                            {currentPosition.sellPreflight.status === 'NO_EXECUTABLE_LIQUIDITY' ? (
                              'Insufficient executable liquidity: no positive exit is currently possible.'
                            ) : (
                              <>
                                Liquidity-limited: full exit unavailable. Max executable exit:{' '}
                                {formatUnits(
                                  currentPosition.sellPreflight.maxExecutableQuantityBaseUnits,
                                  currentPosition.tokenDecimals,
                                  currentPosition.tokenDecimals,
                                )}{' '}
                                tokens for{' '}
                                {formatSol(
                                  currentPosition.sellPreflight.maxExecutableOutputLamports,
                                  9,
                                )}
                                . Executable-portion P&amp;L:{' '}
                                {formatSol(
                                  currentPosition.sellPreflight.executablePortionPnlLamports!,
                                  9,
                                )}
                                . Not full-position P&amp;L.
                                <button
                                  disabled={
                                    !tradeReady || !market?.supported || !open || Boolean(pending)
                                  }
                                  onClick={() =>
                                    void sell(
                                      currentPosition.sellPreflight!.maxExecutableQuantityBaseUnits,
                                      'Sold max executable',
                                    )
                                  }
                                >
                                  SELL MAX EXECUTABLE
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      {!currentPosition.sellPreflight &&
                        currentPosition.valuation.status !== 'AVAILABLE' && (
                          <div className="pf-inline-error">
                            Exit valuation unavailable: {currentPosition.valuation.reason}.
                            Retrying…
                          </div>
                        )}
                    </div>
                  )}
                  {!currentPosition && tradeReady && market?.supported && (
                    <div className="pf-empty-position">No position in this token.</div>
                  )}
                  {chartAvailable === false &&
                    (averageEntry ||
                      trades.some((trade) => trade.mint_address === resolvedMint)) && (
                      <div className="pf-refresh-status">
                        {terminal.terminal === 'GMGN' && chartReason === 'GMGN_USD_MC_ONLY'
                          ? 'PF drawings support USD Market Cap mode.'
                          : terminal.terminal === 'GMGN' && ['GMGN_UNITS_UNVERIFIED', 'GMGN_UNITS_AMBIGUOUS'].includes(chartReason ?? '')
                            ? 'PF drawings await verified USD Market Cap mode.'
                          : chartReason === 'GMGN_CHART_INITIALIZING'
                            ? 'GMGN chart initializing. PF drawings will retry.'
                            : chartReason === 'HISTORICAL_FX_NOT_CAPTURED'
                          ? 'PF AVG USD unavailable: an older BUY has no saved execution-time FX.'
                          : chartReason === 'HISTORICAL_FX_PROVIDER_NOT_CONFIGURED'
                            ? 'PF AVG USD conversion pending: historical price provider is not configured.'
                            : chartReason === 'HISTORICAL_SOL_USD_UNAVAILABLE'
                              ? 'PF AVG USD conversion pending: historical fill pricing is unavailable.'
                              : chartReason === 'AUTHORITATIVE_SUPPLY_UNAVAILABLE'
                                ? 'PF AVG needs verified token supply for Market Cap mode.'
                                : 'PF AVG chart line unavailable. Paperfund fills remain saved.'}
                      </div>
                    )}
                </>
              )}
            </>
          )}
          <a className="pf-open" href={PAPERFUND_APP_URL} target="_blank" rel="noreferrer">
            OPEN PAPERFUND ↗
          </a>
          <div
            className="pf-resize-handle"
            role="separator"
            aria-label="Resize Paperfund panel"
            onPointerDown={onResizeStart}
          />
        </>
      )}
    </section>
  );
}

function MarketState({
  terminal,
  market,
  loading,
  issue,
}: {
  terminal: TerminalTokenState;
  market: MarketSupport | null;
  loading: boolean;
  issue: string | null;
}) {
  if (terminal.status === 'NO_MARKET')
    return <div className="pf-market empty">Open a supported Solana token page.</div>;
  if (terminal.status === 'DETECTION_UNAVAILABLE' || !terminal.mint)
    return <div className="pf-market error">Token detection unavailable</div>;
  if (loading && !issue)
    return (
      <div className="pf-market">
        <span>{shorten(terminal.mint)}</span>
        <b>Loading authoritative market…</b>
      </div>
    );
  if (issue)
    return (
      <div className="pf-market error">
        <span>{shorten(terminal.mint)}</span>
        <b>{issue}</b>
      </div>
    );
  if (!market?.supported)
    return (
      <div className="pf-market error">
        <span>{shorten(terminal.mint)}</span>
        <b title={market?.diagnostics}>
          {market?.reason === 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'
            ? 'No executable liquidity found.'
            : 'Market route temporarily unavailable.'}
        </b>
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
function pnlPercent(pnl: string, basis: string): string {
  const denominator = BigInt(basis);
  if (denominator <= 0n) return '—%';
  const sign = BigInt(pnl) < 0n ? '-' : BigInt(pnl) > 0n ? '+' : '';
  const absolute = BigInt(pnl) < 0n ? -BigInt(pnl) : BigInt(pnl);
  const scaled = (absolute * 10_000n) / denominator;
  const whole = scaled / 100n;
  const fraction = (scaled % 100n).toString().padStart(2, '0');
  return `${sign}${whole}.${fraction}%`;
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
