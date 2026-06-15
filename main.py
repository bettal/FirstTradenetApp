# main.py
import asyncio
from trade_manager import TradeManager

trader = TradeManager()

# --- Получение рыночных данных (используется официальный SDK) ---
print(trader.get_quotes("AAPL.US"))

# --- Торговля и управление рисками (используется сторонний API) ---
# Отправляем рыночный ордер
order_id = trader.send_order("AAPL.US", "buy", 10, market_order=True)

# Устанавливаем защитные заявки
trader.set_stop_loss_take_profit("AAPL.US", stop_loss=150, take_profit=180)