import json
from datamodel import Listing, Observation, Order, OrderDepth, ProsperityEncoder, Symbol, Trade, TradingState
from typing import Any, List, Dict
import math

class Logger:
    def __init__(self) -> None:
        self.logs = ""
        self.max_log_length = 3750

    def print(self, *objects: Any, sep: str = " ", end: str = "\n") -> None:
        self.logs += sep.join(map(str, objects)) + end

    def flush(self, state: TradingState, orders: dict[Symbol, list[Order]], conversions: int, trader_data: str) -> None:
        base_length = len(self.to_json([
            self.compress_state(state, ""),
            self.compress_orders(orders),
            conversions,
            "",
            "",
        ]))

        assert base_length < 4000, "Base output is too large."

        truncated = self.logs[:self.max_log_length]
        print(self.to_json([
            self.compress_state(state, trader_data),
            self.compress_orders(orders),
            conversions,
            "",
            truncated,
        ]))
        self.logs = ""

    def compress_state(self, state: TradingState, trader_data: str) -> list[Any]:
        return [
            state.timestamp,
            trader_data,
            self.compress_listings(state.listings),
            self.compress_order_depths(state.order_depths),
            self.compress_trades(state.own_trades),
            self.compress_trades(state.market_trades),
            state.position,
            self.compress_observations(state.observations),
        ]

    def compress_listings(self, listings: dict[Symbol, Listing]) -> list[list[Any]]:
        return [[listing.symbol, listing.product, listing.denomination] for listing in listings.values()]

    def compress_order_depths(self, order_depths: dict[Symbol, OrderDepth]) -> dict[Symbol, list[Any]]:
        return {symbol: [depth.buy_orders, depth.sell_orders] for symbol, depth in order_depths.items()}

    def compress_trades(self, trades: dict[Symbol, list[Trade]]) -> list[list[Any]]:
        compressed = []
        for arr in trades.values():
            for trade in arr:
                compressed.append([
                    trade.symbol,
                    trade.price,
                    trade.quantity,
                    trade.buyer,
                    trade.seller,
                    trade.timestamp,
                ])
        return compressed

    def compress_observations(self, observations: Observation) -> list[Any]:
        conversion_observations = {}
        for product, observation in observations.conversionObservations.items():
            conversion_observations[product] = [
                observation.bidPrice,
                observation.askPrice,
                observation.transportFees,
                observation.exportTariff,
                observation.importTariff,
                observation.sunlight,
                observation.humidity,
            ]
        return [observations.plainValueObservations, conversion_observations]

    def compress_orders(self, orders: dict[Symbol, list[Order]]) -> list[list[Any]]:
        compressed = []
        for arr in orders.values():
            for order in arr:
                compressed.append([order.symbol, order.price, order.quantity])
        return compressed

    def to_json(self, value: Any) -> str:
        return json.dumps(value, cls=ProsperityEncoder, separators=(",", ":"))

logger = Logger()

class Trader:
    # Defining constants
    HYDROGEL = "HYDROGEL_PACK"
    
    def __init__(self):
        # State tracking for Sniper Trapper logic
        self.prev_hydro_spread = 16
        self.prev_hydro_mid = 0
        self.min_green_buy_price = float('inf')
    
    POS_LIMIT_UNDERLYING = 200

    def run(self, state: TradingState) -> tuple[dict[Symbol, list[Order]], int, str]:
        orders: dict[Symbol, list[Order]] = {}
        conversions = 0
        trader_data = state.traderData
        
        # 3. Market Making Hydrogel Pack
        orders[self.HYDROGEL] = []
        hydro_depth = state.order_depths.get(self.HYDROGEL)
        if hydro_depth and len(hydro_depth.buy_orders) > 0 and len(hydro_depth.sell_orders) > 0:
            best_bid = max(hydro_depth.buy_orders.keys())
            best_ask = min(hydro_depth.sell_orders.keys())
            
            spread = best_ask - best_bid
            mid = (best_bid + best_ask) / 2
            
            # -------------------------------------------------------------
            # SIMPLE MOMENTUM ALIGNED LOGIC WITH MIN PRICE CHECK
            # Buy when we see the "green dot" (Bot Bought, mid > prev_mid)
            # Sell when we see the "red dot" (Bot Sold, mid < prev_mid)
            # -------------------------------------------------------------
            if spread <= 10 and self.prev_hydro_spread >= 14:
                cur_pos = state.position.get(self.HYDROGEL, 0)
                
                if mid > self.prev_hydro_mid:
                    # Green Dot Formed (Bot Bought). We Buy using full limit.
                    buy_qty = self.POS_LIMIT_UNDERLYING - cur_pos
                    if buy_qty > 0:
                        orders[self.HYDROGEL].append(Order(self.HYDROGEL, best_ask, buy_qty))
                        self.min_green_buy_price = min(self.min_green_buy_price, best_ask)
                        
                elif mid < self.prev_hydro_mid:
                    # Red Dot Formed (Bot Sold). We Sell using full limit, checking min green price.
                    if self.min_green_buy_price == float('inf') or best_bid > self.min_green_buy_price:
                        sell_qty = -self.POS_LIMIT_UNDERLYING - cur_pos
                        if sell_qty < 0:
                            orders[self.HYDROGEL].append(Order(self.HYDROGEL, best_bid, sell_qty))

            
            # Update state variables
            self.prev_hydro_spread = spread
            self.prev_hydro_mid = mid

        logger.flush(state, orders, conversions, trader_data)
        return orders, conversions, trader_data
