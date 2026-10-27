# PAPER trading and rewards

Competition authority uses UTC. Hourly accounts start with 10 simulated PAPER SOL; balances do not roll over. A successful first nonzero BUY consumes one of five unique-token slots per hour. Rebuying the same mint uses its existing slot. BUY admission enforces the 20% position limit. Rejected/zero fills cannot consume capacity or mutate balances.

The current model uses fresh validated executable quotes, supported routes, fees, simulated slippage and conservative exit valuation. Missing or incoherent evidence fails closed. It does not promise real-market execution. Historical reserve/liquidity experiments are not the public current-quote model.

Hourly P&L is finalized balance minus starting capital. Daily score sums all finalized hourly P&L attributed by hourly start to that UTC day, including losses/zero. Rankings target top 10 hourly and top 25 daily. Equal scores form rank groups; domain tie allocation and integer rounding govern rewards. Eligibility and finalization remain required.

NORMAL revenue allocation is 63% hourly, 27% daily and 10% platform. BUFFER_ACCUMULATION is 58% hourly, 27% daily, 5% explicit Reward Buffer contribution and 10% platform. Reward Buffer and dynamic hourly pools are explicitly accounted in core/db modules. Accounting ownership differs from available cash and payment authorization.

DURABLE_QUOTE_V2 requires a future-enrolled policy, retained cutoff/provider/route/time evidence and validation before settlement. Historical REVIEW remains where evidence cannot qualify. Real SOL payouts require verified funding, protected obligations, authorized custody, plan checks and STOP release. Current operation is nonpaying with STOP asserted; daily payout code does not establish qualified live daily payouts.
