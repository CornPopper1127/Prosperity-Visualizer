import math
import json
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

    # ── Tunable Parameters (Safest Configuration) ───────────────────────────
    PREMIUM_EMA_WINDOW = 200   # Longer window for extreme stability
    TAKER_THRESHOLD    = 3.5   # High threshold: Only "snatch" massive mispricings
    HEDGE_IV_CONSTANT  = 0.18  # Stable IV for delta calculation
    HEDGE_VOL_THRESHOLD = 15   # Only hedge if delta imbalance is > 15
    MAX_SPOT_SPREAD     = 3    # Only hedge when the "narrowing bot" is active

    def norm_cdf(self, x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def bs_delta(self, S: float, K: float, T: float, r: float, sigma: float) -> float:
        if T <= 0 or sigma <= 0:
            return 1.0 if S > K else 0.0
        d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
        return self.norm_cdf(d1)

    def calculate_ema(self, ema_dict: dict, key: str, window: int, value: float) -> float:
        old = ema_dict.get(key, value)
        alpha = 2.0 / (window + 1)
        new = alpha * value + (1.0 - alpha) * old
        ema_dict[key] = new
        return new

    def run(self, state: TradingState):
        result = {}
        conversions = 0

        # ── Load State ────────────────────────────────────────────────────────
        try:
            saved = json.loads(state.traderData)
            ema_dict = saved.get('ema', {})
        except Exception:
            ema_dict = {}

        # ── 1. Spot Market Context ────────────────────────────────────────────
        spot_product = 'VELVETFRUIT_EXTRACT'
        if spot_product not in state.order_depths:
            return result, conversions, state.traderData

        s_depth = state.order_depths[spot_product]
        if not s_depth.buy_orders or not s_depth.sell_orders:
            return result, conversions, state.traderData

        s_bid = max(s_depth.buy_orders.keys())
        s_ask = min(s_depth.sell_orders.keys())
        s_mid = (s_bid + s_ask) / 2.0
        s_spread = s_ask - s_bid
        
        spot_pos = state.position.get(spot_product, 0)
        spot_limit = self.POSITION_LIMITS[spot_product]

        # TTE
        tte_days = 5.0 - (state.timestamp / 1_000_000.0)
        TTE = max(tte_days / 365.0, 1e-6)

        option_symbols = [f'VEV_{k}' for k in [4000, 4500, 5000, 5100, 5200, 5300, 5400, 5500, 6000, 6500]]
        
        total_delta = 0.0

        # ── 2. Option Sniper (Taker Only) ─────────────────────────────────────
        for sym in option_symbols:
            if sym not in state.order_depths: continue
            depth = state.order_depths[sym]
            if not depth.buy_orders or not depth.sell_orders: continue

            K = float(sym.split('_')[1])
            best_bid = max(depth.buy_orders.keys())
            best_ask = min(depth.sell_orders.keys())
            call_mid = (best_bid + best_ask) / 2.0
            pos = state.position.get(sym, 0)
            limit = self.POSITION_LIMITS[sym]
            
            # Empirical Premium Analysis
            intrinsic = max(0.0, s_mid - K)
            premium = call_mid - intrinsic
            ema_p = self.calculate_ema(ema_dict, f'{sym}_p', self.PREMIUM_EMA_WINDOW, premium)
            fair_v = intrinsic + ema_p
            
            orders = []
            
            # SAFE TAKER ONLY: No passive quotes. We only enter if someone else
            # is offering a price that is mathematically "dumb."
            
            # 1. Option is massively overpriced? Hit the Bid.
            if best_bid > fair_v + self.TAKER_THRESHOLD:
                vol = min(depth.buy_orders[best_bid], limit + pos)
                if vol > 0: orders.append(Order(sym, best_bid, -vol))
            
            # 2. Option is massively underpriced? Lift the Ask.
            elif best_ask < fair_v - self.TAKER_THRESHOLD:
                vol = min(abs(depth.sell_orders[best_ask]), limit - pos)
                if vol > 0: orders.append(Order(sym, best_ask, vol))

            if orders:
                result[sym] = orders

            # Track total delta for the hedge
            total_delta += pos * self.bs_delta(s_mid, K, TTE, 0.0, self.HEDGE_IV_CONSTANT)

        # ── 3. Smart Hedging (The Safety Net) ─────────────────────────────────
        target_pos = -round(total_delta)
        hedge_qty  = target_pos - spot_pos
        
        # Only hedge if:
        # A) The "narrowing bot" is present (s_spread <= 3) to avoid high slippage.
        # B) OR our delta risk is getting too high (> 15 units).
        should_hedge = (s_spread <= self.MAX_SPOT_SPREAD) or (abs(hedge_qty) > self.HEDGE_VOL_THRESHOLD)

        if should_hedge:
            spot_orders = []
            if hedge_qty > 0:
                h_vol = min(hedge_qty, spot_limit - spot_pos)
                if h_vol > 0: spot_orders.append(Order(spot_product, s_ask, h_vol))
            elif hedge_qty < 0:
                h_vol = max(hedge_qty, -(spot_limit + spot_pos))
                if h_vol < 0: spot_orders.append(Order(spot_product, s_bid, h_vol))
            
            if spot_orders:
                result[spot_product] = spot_orders

        # ── Persist ───────────────────────────────────────────────────────────
        traderData = json.dumps({'ema': ema_dict})
        return result, conversions, traderData
