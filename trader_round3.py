import math
import json
import numpy as np
from typing import List, Dict
from datamodel import OrderDepth, TradingState, Order


class Trader:
    # ── Position limits ──────────────────────────────────────────────────────
    POSITION_LIMITS = {
        'VELVETFRUIT_EXTRACT': 200,
        'HYDROGEL_PACK': 200,
        'VEV_4000': 300,
        'VEV_4500': 300,
        'VEV_5000': 300,
        'VEV_5100': 300,
        'VEV_5200': 300,
        'VEV_5300': 300,
        'VEV_5400': 300,
        'VEV_5500': 300,
        'VEV_6000': 300,
        'VEV_6500': 300,
    }

    # ── Tunable parameters ───────────────────────────────────────────────────
    # Rolling window: keep the last SMILE_WINDOW ticks × n_strikes observations
    # for the quadratic surface fit.  Smaller → more reactive; larger → more
    # stable.  Start at 50 and tune after backtesting.
    SMILE_WINDOW    = 50    # ticks to include in the rolling smile fit
    IV_EMA_WINDOW   = 30    # EMA window for per-strike IV (used only for delta)
    IV_NOISE_FLOOR  = 0.05  # discard IVs below 5% (deep-ITM numerical noise)
    EDGE            = 1.0   # half-spread around fair price (seashells)

    # ── Black-Scholes helpers ────────────────────────────────────────────────

    def norm_cdf(self, x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def bs_call_price(self, S: float, K: float, T: float, r: float, sigma: float) -> float:
        if T <= 0 or sigma <= 0:
            return max(0.0, S - K)
        d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        return S * self.norm_cdf(d1) - K * math.exp(-r * T) * self.norm_cdf(d2)

    def bs_delta(self, S: float, K: float, T: float, r: float, sigma: float) -> float:
        """Call delta N(d1)."""
        if T <= 0 or sigma <= 0:
            return 1.0 if S > K else 0.0
        d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
        return self.norm_cdf(d1)

    def find_iv(self, S: float, K: float, T: float, r: float, C_market: float) -> float:
        """Bisection IV solver — stable for all moneyness levels."""
        if T <= 0 or C_market <= 0:
            return 0.0
        intrinsic = max(0.0, S - K)
        if C_market <= intrinsic:
            return 0.0
        low, high = 1e-4, 5.0
        for _ in range(100):
            mid = (low + high) / 2.0
            if self.bs_call_price(S, K, T, r, mid) < C_market:
                low = mid
            else:
                high = mid
        return (low + high) / 2.0

    def calculate_ema(self, ema_dict: dict, key: str, window: int, value: float) -> float:
        old = ema_dict.get(key, value)
        alpha = 2.0 / (window + 1)
        new = alpha * value + (1.0 - alpha) * old
        ema_dict[key] = new
        return new

    # ── Main trading loop ────────────────────────────────────────────────────

    def run(self, state: TradingState):
        result = {}
        conversions = 0

        # ── Load persisted state ─────────────────────────────────────────────
        try:
            saved = json.loads(state.traderData)
            ema_dict     = saved.get('ema', {})
            # smile_history: list of [moneyness, raw_iv] pairs from recent ticks
            smile_history = saved.get('smile_history', [])
        except Exception:
            ema_dict      = {}
            smile_history = []

        # ── Spot market ───────────────────────────────────────────────────────
        spot_product = 'VELVETFRUIT_EXTRACT'
        if spot_product not in state.order_depths:
            return result, conversions, state.traderData

        spot_depth = state.order_depths[spot_product]
        if not spot_depth.buy_orders or not spot_depth.sell_orders:
            return result, conversions, state.traderData

        spot_bid  = max(spot_depth.buy_orders.keys())
        spot_ask  = min(spot_depth.sell_orders.keys())
        spot_mid  = (spot_bid + spot_ask) / 2.0
        spot_pos  = state.position.get(spot_product, 0)
        spot_limit = self.POSITION_LIMITS[spot_product]
        spot_orders = []

        # ── Time to expiry ────────────────────────────────────────────────────
        # 5 trading days total; linear intraday decay matches the visualizer.
        tte_days = 5.0 - (state.timestamp / 1_000_000.0)
        TTE = max(tte_days / 365.0, 1e-6)

        option_symbols = [f'VEV_{k}' for k in [4000, 4500, 5000, 5100, 5200, 5300, 5400, 5500, 6000, 6500]]

        total_delta   = 0.0
        option_data   = {}
        this_tick_obs = []   # new (moneyness, raw_iv) pairs from this tick

        # ── Step 1: compute IVs and collect observations ──────────────────────
        for sym in option_symbols:
            if sym not in state.order_depths:
                continue
            depth = state.order_depths[sym]
            if not depth.buy_orders or not depth.sell_orders:
                continue

            K        = float(sym.split('_')[1])
            best_bid = max(depth.buy_orders.keys())
            best_ask = min(depth.sell_orders.keys())
            call_mid = (best_bid + best_ask) / 2.0
            pos      = state.position.get(sym, 0)

            raw_iv  = self.find_iv(spot_mid, K, TTE, 0.0, call_mid)
            # EMA-smoothed IV for delta calculation only (more stable hedge)
            ema_iv  = self.calculate_ema(ema_dict, f'{sym}_iv', self.IV_EMA_WINDOW, raw_iv)
            delta   = self.bs_delta(spot_mid, K, TTE, 0.0, ema_iv)
            total_delta += pos * delta

            # Percentage moneyness — identical definition to the visualizer
            moneyness = (spot_mid - K) / spot_mid

            # Exclude deep-ITM noise from the smile fit
            if raw_iv >= self.IV_NOISE_FLOOR:
                this_tick_obs.append([moneyness, raw_iv])

            option_data[sym] = {
                'K': K, 'moneyness': moneyness,
                'pos': pos, 'best_bid': best_bid, 'best_ask': best_ask,
                'limit': self.POSITION_LIMITS[sym], 'ema_iv': ema_iv,
            }

        # ── Step 2: update rolling window and fit the volatility smile ────────
        smile_history.extend(this_tick_obs)
        # Cap: SMILE_WINDOW ticks × 10 strikes = up to 500 points
        max_hist = self.SMILE_WINDOW * len(option_symbols)
        if len(smile_history) > max_hist:
            smile_history = smile_history[-max_hist:]

        if len(smile_history) >= 3:
            mn_arr = np.array([p[0] for p in smile_history])
            iv_arr = np.array([p[1] for p in smile_history])
            # Unweighted least-squares quadratic — same math as visualizer's
            # polyFit2, and identical to np.polyfit with deg=2.
            smile_coeffs = np.polyfit(mn_arr, iv_arr, 2)
        else:
            smile_coeffs = np.array([0.0, 0.0, 0.20])   # flat 20% fallback

        # ── Step 3: market-make around the fitted smile ───────────────────────
        for sym, data in option_data.items():
            fair_iv = float(np.polyval(smile_coeffs, data['moneyness']))
            fair_iv = max(fair_iv, 0.01)   # clamp: negative IV is meaningless

            fair_price = self.bs_call_price(spot_mid, data['K'], TTE, 0.0, fair_iv)
            my_bid     = int(math.floor(fair_price - self.EDGE))
            my_ask     = int(math.ceil(fair_price  + self.EDGE))

            max_buy  = data['limit'] - data['pos']
            max_sell = data['limit'] + data['pos']

            orders = []
            if max_buy  > 0: orders.append(Order(sym, my_bid,  max_buy))
            if max_sell > 0: orders.append(Order(sym, my_ask, -max_sell))
            if orders:
                result[sym] = orders

        # ── Step 4: delta-hedge the spot ─────────────────────────────────────
        target_pos = -round(total_delta)
        hedge_qty  = target_pos - spot_pos

        if hedge_qty > 0:
            hedge_qty = min(hedge_qty, spot_limit - spot_pos)
            if hedge_qty > 0:
                spot_orders.append(Order(spot_product, spot_ask, hedge_qty))
        elif hedge_qty < 0:
            sell_amt = max(hedge_qty, -(spot_limit + spot_pos))
            if sell_amt < 0:
                spot_orders.append(Order(spot_product, spot_bid, sell_amt))

        if spot_orders:
            result[spot_product] = spot_orders

        # ── Persist state ─────────────────────────────────────────────────────
        traderData = json.dumps({'ema': ema_dict, 'smile_history': smile_history})
        return result, conversions, traderData
