# trade_manager.py
from tradernet import Tradernet as OfficialSDK
from tradernet_api.api import API as ThirdPartyAPI
from config import TRADERNET_CONFIG

class TradeManager:
    def __init__(self):
        # Инициализация официального SDK
        self.official_api = OfficialSDK(
            TRADERNET_CONFIG["public_key"],
            TRADERNET_CONFIG["private_key"]
        )
        # Инициализация стороннего клиента для работы со стоп-заявками
        self.third_party_api = ThirdPartyAPI(
            api_key=TRADERNET_CONFIG["public_key"],
            secret_key=TRADERNET_CONFIG["private_key"]
        )
        print("Оба API инициализированы")

    # --- Данные (используем официальный SDK) ---
    def get_quotes(self, ticker):
        """Получение котировок через официальный SDK"""
        return self.official_api.quotes_get(ticker) # Название метода может отличаться

    # --- Исполнение ордеров (используем сторонний клиент) ---
    def send_order(self, ticker, side, count, **kwargs):
        """Отправка обычного ордера через сторонний API"""
        return self.third_party_api.send_order(ticker=ticker, side=side, count=count, **kwargs)

    def set_stop_loss_take_profit(self, ticker, stop_loss=None, take_profit=None):
        """Установка стоп-лосса и/или тейк-профита"""
        return self.third_party_api.set_stop_order(
            ticker=ticker,
            stop_loss=stop_loss,
            take_profit=take_profit
        )