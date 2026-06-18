import http.server
import socketserver
import json
import os
import re
import uuid
import urllib.parse
import urllib.request
import urllib.error
from http.cookies import SimpleCookie
import base64
import hmac
import hashlib
import struct
import time
import logging
from concurrent.futures import ThreadPoolExecutor
import bcrypt
import psycopg2
import psycopg2.pool
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('logs/backend.log'),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

# Import Tradernet modules for hybrid system
try:
    from tradernet import Tradernet as OfficialSDK
    from tradernet_api.api import API as ThirdPartyAPI
except ImportError:
    OfficialSDK = None
    ThirdPartyAPI = None

IN_MEMORY_SESSIONS = {}
TFA_VERIFY_TIMEOUT = 300  # 5 minutes
CSRF_TOKEN_BYTES = 32
BRUTE_FORCE_MAX_ATTEMPTS = 5
BRUTE_FORCE_LOCKOUT_MINUTES = 15

# Thread pool for request handling (max 20 concurrent)
executor = ThreadPoolExecutor(max_workers=20)

# Session cleanup interval
SESSION_MAX_AGE = 86400  # 24 hours
_last_session_cleanup = time.time()

def _cleanup_sessions():
    """Remove expired in-memory sessions."""
    global _last_session_cleanup
    now = time.time()
    if now - _last_session_cleanup < 3600:
        return
    _last_session_cleanup = now
    expired = []
    for token, data in list(IN_MEMORY_SESSIONS.items()):
        if now - data.get('created_at', 0) > SESSION_MAX_AGE:
            expired.append(token)
    for token in expired:
        del IN_MEMORY_SESSIONS[token]
    if expired:
        log.info(f"Cleaned up {len(expired)} expired sessions")

def hash_password(password: str) -> str:
    """Hash a password securely using bcrypt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def check_password(password: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except ValueError:
        return False

def generate_totp_secret():
    """Generate a random 32-character Base32 secret."""
    return base64.b32encode(os.urandom(20)).decode('utf-8')

def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Verify a TOTP code with a given time window."""
    try:
        key = base64.b32decode(secret, True)
    except:
        return False
    
    current_time = int(time.time()) // 30
    for i in range(-window, window + 1):
        msg = struct.pack(">Q", current_time + i)
        h = hmac.new(key, msg, hashlib.sha1).digest()
        o = h[19] & 15
        h = (struct.unpack(">I", h[o:o+4])[0] & 0x7fffffff) % 1000000
        if f"{h:06d}" == code:
            return True
    return False

import ssl

PORT = int(os.environ.get('PORT', 8000))

# PostgreSQL configuration (use environment variables with defaults)
DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_PORT = int(os.environ.get('DB_PORT', 5432))
DB_NAME = os.environ.get('DB_NAME', 'tradernet')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASSWORD = os.environ.get('DB_PASSWORD', 'postgres')

# Connection pool (min 2, max 20 connections)
db_pool = None

def _init_db_pool():
    global db_pool
    if db_pool is None:
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            2, 20,
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
            user=DB_USER, password=DB_PASSWORD
        )

def get_db():
    """Get a database connection from the pool."""
    _init_db_pool()
    return db_pool.getconn()

def close_db(conn):
    """Return a database connection to the pool."""
    if db_pool and conn:
        try:
            db_pool.putconn(conn)
        except Exception:
            try:
                close_db(conn)
            except Exception:
                pass

# Initialize DB
def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            phone TEXT UNIQUE,
            session_token TEXT,
            totp_secret TEXT,
            password_hash TEXT,
            totp_enabled INTEGER DEFAULT 0,
            salt TEXT
        )
    ''')
    # Add columns if they don't exist (safe migration using DO block)
    for col_name, col_def in [
        ('password_hash', 'TEXT'),
        ('totp_enabled', 'INTEGER DEFAULT 0'),
        ('salt', 'TEXT'),
        ('failed_attempts', 'INTEGER DEFAULT 0'),
        ('locked_until', 'TIMESTAMP'),
    ]:
        c.execute(f"""
            DO $$ BEGIN
                ALTER TABLE users ADD COLUMN {col_name} {col_def};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """)
    c.execute('''
        CREATE TABLE IF NOT EXISTS wallets (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            name TEXT,
            api_key TEXT,
            secret_key TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    # Add login/password columns if missing
    for col_name, col_def in [
        ('login', 'TEXT'),
        ('password', 'TEXT'),
    ]:
        c.execute(f"""
            DO $$ BEGIN
                ALTER TABLE wallets ADD COLUMN {col_name} {col_def};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """)
    c.execute('''
        CREATE TABLE IF NOT EXISTS api_dictionaries (
            id SERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            endpoint TEXT NOT NULL,
            category TEXT DEFAULT 'various',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS api_dictionary_entries (
            id SERIAL PRIMARY KEY,
            dictionary_id INTEGER NOT NULL,
            entry_code TEXT,
            entry_name TEXT,
            entry_data JSONB DEFAULT '{}'::jsonb,
            FOREIGN KEY(dictionary_id) REFERENCES api_dictionaries(id) ON DELETE CASCADE
        )
    ''')
    # Seed dictionaries
    dicts = [
        ("reception_types", "Office Types", "List of existing offices/reception types", "getReceptionTypes"),
        ("mkt", "Trading Platforms", "Trading platforms / markets", "getMkt"),
        ("instruments", "Instruments", "Instruments details and specifications", "getInstruments"),
        ("cps_types_list", "Request Types", "Types of client requests (CPS)", "getCPSTypesList"),
        ("passport_type", "Document Types", "Types of identity documents", "getPassportType"),
        ("order_statuses", "Order Statuses", "Possible order status values", "getOrderStatuses"),
        ("safety", "Signature Types", "Types of electronic signatures", "getSafetyTypes"),
        ("type_codes", "Valid Codes", "Types of valid/trade codes", "getTypeCodes"),
    ]
    for code, name, desc, endpoint in dicts:
        c.execute("""
            INSERT INTO api_dictionaries (code, name, description, endpoint)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, endpoint=EXCLUDED.endpoint
        """, (code, name, desc, endpoint))
    conn.commit()
    # Create missing indexes (safe IF NOT EXISTS pattern)
    c.execute('CREATE INDEX IF NOT EXISTS idx_users_session_token ON users(session_token)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_dict_entries_dict_id ON api_dictionary_entries(dictionary_id)')
    conn.commit()
    close_db(conn)

init_db()

class TradeManager:
    """
    Hybrid Tradernet API manager that combines official SDK and third-party API
    """
    def __init__(self, public_key: str, private_key: str):
        self.public_key = public_key
        self.private_key = private_key
        
        # Initialize official SDK if available
        if OfficialSDK:
            self.official_api = OfficialSDK(
                self.public_key,
                self.private_key
            )
        else:
            self.official_api = None
            
        # Initialize third-party API if available
        if ThirdPartyAPI:
            self.third_party_api = ThirdPartyAPI(
                api_key=self.public_key,
                secret_key=self.private_key
            )
        else:
            self.third_party_api = None

    # --- Market data methods (using official SDK) ---
    def get_quotes(self, ticker: str):
        """Get quotes using official SDK"""
        if self.official_api:
            return self.official_api.quotes_get(ticker)
        else:
            raise Exception("Official SDK not available")

    # --- Order execution methods (using third-party API) ---
    def send_order(self, ticker: str, side: str, count: int, **kwargs):
        """Send order using third-party API"""
        if self.third_party_api:
            return self.third_party_api.send_order(ticker=ticker, side=side, count=count, **kwargs)
        else:
            raise Exception("Third-party API not available")

    def set_stop_loss_take_profit(self, ticker: str, stop_loss=None, take_profit=None):
        """Set stop-loss and/or take-profit orders"""
        if self.third_party_api:
            return self.third_party_api.set_stop_order(
                ticker=ticker,
                stop_loss=stop_loss,
                take_profit=take_profit
            )
        else:
            raise Exception("Third-party API not available")

COMMANDS_REGISTRY = [
    # === User Data ===
    {"name": "getOPQ", "display_name": "Initial User Data (OPQ)", "category": "user_data", "category_display": "User Data", "library": "raw_v2", "cmd": "getOPQ", "params": []},
    {"name": "getSIDInfo", "display_name": "Session Information", "category": "user_data", "category_display": "User Data", "library": "raw_v2", "cmd": "getSIDInfo", "params": []},

    # === Security Session ===
    {"name": "getSecuritySessions", "display_name": "Security Sessions List", "category": "security_session", "category_display": "Security Session", "library": "raw_v2", "cmd": "getSecuritySessions", "params": []},
    {"name": "openSecuritySession", "display_name": "Open Security Session", "category": "security_session", "category_display": "Security Session", "library": "raw_v2", "cmd": "openSecuritySession", "params": [
        {"name": "session_type", "type": "string", "required": True, "description": "Session type code"}
    ]},

    # === Set up the list of securities ===
    {"name": "getSecuritiesLists", "display_name": "Get Securities Lists", "category": "securities_lists", "category_display": "Securities Lists", "library": "raw_v2", "cmd": "getSecuritiesLists", "params": []},
    {"name": "addSecuritiesList", "display_name": "Add Securities List", "category": "securities_lists", "category_display": "Securities Lists", "library": "raw_v2", "cmd": "addSecuritiesList", "params": [
        {"name": "name", "type": "string", "required": True, "description": "List name"}
    ]},
    {"name": "updateSecuritiesList", "display_name": "Update Securities List", "category": "securities_lists", "category_display": "Securities Lists", "library": "raw_v2", "cmd": "updateSecuritiesList", "params": [
        {"name": "list_id", "type": "int", "required": True, "description": "List ID"},
        {"name": "name", "type": "string", "required": False, "description": "New name"}
    ]},
    {"name": "deleteSecuritiesList", "display_name": "Delete Securities List", "category": "securities_lists", "category_display": "Securities Lists", "library": "raw_v2", "cmd": "deleteSecuritiesList", "params": [
        {"name": "list_id", "type": "int", "required": True, "description": "List ID"}
    ]},
    {"name": "makeListSelected", "display_name": "Select Securities List", "category": "securities_lists", "category_display": "Securities Lists", "library": "raw_v2", "cmd": "makeListSelected", "params": [
        {"name": "list_id", "type": "int", "required": True, "description": "List ID"}
    ]},
    {"name": "addListTicker", "display_name": "Add Ticker to List", "category": "securities_lists", "category_display": "Securities Lists", "library": "raw_v2", "cmd": "addListTicker", "params": [
        {"name": "list_id", "type": "int", "required": True, "description": "List ID"},
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"}
    ]},
    {"name": "deleteListTicker", "display_name": "Delete Ticker from List", "category": "securities_lists", "category_display": "Securities Lists", "library": "raw_v2", "cmd": "deleteListTicker", "params": [
        {"name": "list_id", "type": "int", "required": True, "description": "List ID"},
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"}
    ]},

    # === Quotes and Tickers ===
    {"name": "getMarketStatus", "display_name": "Market Status", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getMarketStatus", "params": [
        {"name": "market", "type": "string", "required": False, "default": "*", "description": "Market code"}
    ]},
    {"name": "getSecurityInfo", "display_name": "Ticker Info", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getSecurityInfo", "params": [
        {"name": "symbol", "type": "string", "required": True, "description": "Ticker symbol (e.g. AAPL.US)"},
        {"name": "sup", "type": "bool", "required": False, "default": True, "description": "Extended info format"}
    ]},
    {"name": "getOptionsByMkt", "display_name": "Options by Market", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getOptionsByMkt", "params": [
        {"name": "market", "type": "string", "required": True, "description": "Market code"},
        {"name": "ticker", "type": "string", "required": True, "description": "Base ticker"}
    ]},
    {"name": "getTopSecurities", "display_name": "Most Traded Securities", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getTopSecurities", "params": [
        {"name": "market", "type": "string", "required": True, "description": "Market code"},
        {"name": "limit", "type": "int", "required": False, "default": 10, "description": "Max count"}
    ]},
    {"name": "quotesGet", "display_name": "Get Quote", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "quotesGet", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"}
    ]},
    {"name": "getOrderBook", "display_name": "Order Book (Depth)", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getOrderBook", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"}
    ]},
    {"name": "getHLOC", "display_name": "Historical Candles", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getHLOC", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "period", "type": "string", "required": False, "default": "day", "description": "Period: 1min, 5min, 15min, 30min, hour, day, week, month, year"},
        {"name": "from", "type": "string", "required": False, "description": "Start date (YYYY-MM-DD)"},
        {"name": "to", "type": "string", "required": False, "description": "End date (YYYY-MM-DD)"},
        {"name": "limit", "type": "int", "required": False, "default": 100, "description": "Max candles"}
    ]},
    {"name": "getTrades", "display_name": "Get Trades", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getTrades", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "limit", "type": "int", "required": False, "default": 20, "description": "Max count"}
    ]},
    {"name": "getTradesHistory", "display_name": "Trades History", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getTradesHistory", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "from", "type": "string", "required": False, "description": "Start date (YYYY-MM-DD)"},
        {"name": "to", "type": "string", "required": False, "description": "End date (YYYY-MM-DD)"},
        {"name": "limit", "type": "int", "required": False, "default": 100, "description": "Max count"}
    ]},
    {"name": "securityFinder", "display_name": "Ticker Search", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "securityFinder", "params": [
        {"name": "query", "type": "string", "required": True, "description": "Search query"},
        {"name": "limit", "type": "int", "required": False, "default": 20, "description": "Max results"}
    ]},
    {"name": "getNews", "display_name": "News on Securities", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getNews", "params": [
        {"name": "ticker", "type": "string", "required": False, "description": "Ticker filter (optional)"},
        {"name": "limit", "type": "int", "required": False, "default": 20, "description": "Max news items"}
    ]},
    {"name": "getSecurities", "display_name": "Directory of Securities", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "getSecurities", "params": [
        {"name": "market", "type": "string", "required": False, "description": "Market code filter"},
        {"name": "limit", "type": "int", "required": False, "default": 50, "description": "Max results"}
    ]},
    {"name": "checkAllowedTicker", "display_name": "Check Allowed Ticker", "category": "quotes_tickers", "category_display": "Quotes & Tickers", "library": "raw_v2", "cmd": "checkAllowedTicker", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"}
    ]},

    # === Portfolio ===
    {"name": "getPortfolio", "display_name": "Portfolio Info", "category": "portfolio", "category_display": "Portfolio", "library": "raw_v2", "cmd": "getPortfolio", "params": []},

    # === Orders ===
    {"name": "getCurrentOrders", "display_name": "Current Orders", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "getNotifyOrderJson", "params": [
        {"name": "active_only", "type": "bool", "required": False, "default": True, "description": "Show only active orders"}
    ]},
    {"name": "getOrdersHistory", "display_name": "Orders History", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "getOrdersHistory", "params": [
        {"name": "from", "type": "string", "required": False, "description": "Start date (YYYY-MM-DD)"},
        {"name": "to", "type": "string", "required": False, "description": "End date (YYYY-MM-DD)"},
        {"name": "limit", "type": "int", "required": False, "default": 50, "description": "Max orders"}
    ]},
    {"name": "putTradeOrder", "display_name": "Send Order", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "putTradeOrder", "params": [
        {"name": "instr_name", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "side", "type": "string", "required": True, "description": "buy / sell"},
        {"name": "qty", "type": "int", "required": True, "description": "Quantity"},
        {"name": "market_order", "type": "bool", "required": False, "default": True, "description": "Market order"},
        {"name": "limit_price", "type": "float", "required": False, "default": 0, "description": "Limit price"},
        {"name": "stop_price", "type": "float", "required": False, "default": 0, "description": "Stop price"},
        {"name": "expiry", "type": "string", "required": False, "default": "day", "description": "day / ext / gtc"}
    ]},
    {"name": "putStopLoss", "display_name": "Stop Loss / Take Profit", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "putStopLoss", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "stop_loss", "type": "float", "required": False, "default": 0, "description": "Stop loss price"},
        {"name": "take_profit", "type": "float", "required": False, "default": 0, "description": "Take profit price"}
    ]},
    {"name": "delTradeOrder", "display_name": "Cancel Order", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "delTradeOrder", "params": [
        {"name": "order_id", "type": "string", "required": True, "description": "Order ID to cancel"}
    ]},

    # === Price Alerts ===
    {"name": "getAlerts", "display_name": "Get Alerts", "category": "price_alerts", "category_display": "Price Alerts", "library": "raw_v2", "cmd": "getAlerts", "params": []},
    {"name": "addAlert", "display_name": "Add Alert", "category": "price_alerts", "category_display": "Price Alerts", "library": "raw_v2", "cmd": "addAlert", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "price", "type": "float", "required": True, "description": "Alert price"},
        {"name": "condition", "type": "string", "required": True, "description": "above / below"}
    ]},
    {"name": "deleteAlert", "display_name": "Delete Alert", "category": "price_alerts", "category_display": "Price Alerts", "library": "raw_v2", "cmd": "deleteAlert", "params": [
        {"name": "alert_id", "type": "string", "required": True, "description": "Alert ID"}
    ]},

    # === Requests ===
    {"name": "getClientCPSHistory", "display_name": "Client Requests History", "category": "requests", "category_display": "Requests", "library": "raw_v2", "cmd": "getClientCPSHistory", "params": [
        {"name": "from", "type": "string", "required": False, "description": "Start date"},
        {"name": "to", "type": "string", "required": False, "description": "End date"},
        {"name": "limit", "type": "int", "required": False, "default": 50, "description": "Max results"}
    ]},
    {"name": "getCPSFiles", "display_name": "Request Files", "category": "requests", "category_display": "Requests", "library": "raw_v2", "cmd": "getCPSFiles", "params": [
        {"name": "request_id", "type": "string", "required": True, "description": "Request ID"}
    ]},

    # === Broker Report ===
    {"name": "getBrokerReport", "display_name": "Broker Report", "category": "broker_report", "category_display": "Broker Report", "library": "raw_v2", "cmd": "getBrokerReport", "params": [
        {"name": "from", "type": "string", "required": False, "description": "Start date"},
        {"name": "to", "type": "string", "required": False, "description": "End date"}
    ]},
    {"name": "getBrokerReportURL", "display_name": "Broker Report Link", "category": "broker_report", "category_display": "Broker Report", "library": "raw_v2", "cmd": "getBrokerReportURL", "params": [
        {"name": "from", "type": "string", "required": False, "description": "Start date"},
        {"name": "to", "type": "string", "required": False, "description": "End date"}
    ]},
    {"name": "getDepositaryReport", "display_name": "Depository Report", "category": "broker_report", "category_display": "Broker Report", "library": "raw_v2", "cmd": "getDepositaryReport", "params": [
        {"name": "from", "type": "string", "required": False, "description": "Start date"},
        {"name": "to", "type": "string", "required": False, "description": "End date"}
    ]},
    {"name": "getDepositaryReportURL", "display_name": "Depository Report Link", "category": "broker_report", "category_display": "Broker Report", "library": "raw_v2", "cmd": "getDepositaryReportURL", "params": [
        {"name": "from", "type": "string", "required": False, "description": "Start date"},
        {"name": "to", "type": "string", "required": False, "description": "End date"}
    ]},
    {"name": "getCashflows", "display_name": "Money Movement", "category": "broker_report", "category_display": "Broker Report", "library": "raw_v2", "cmd": "getCashflows", "params": [
        {"name": "from", "type": "string", "required": False, "description": "Start date"},
        {"name": "to", "type": "string", "required": False, "description": "End date"}
    ]},

    # === Currencies ===
    {"name": "getCrossRatesForDate", "display_name": "Exchange Rate by Date", "category": "currencies", "category_display": "Currencies", "library": "raw_v2", "cmd": "getCrossRatesForDate", "params": [
        {"name": "date", "type": "string", "required": True, "description": "Date (YYYY-MM-DD)"}
    ]},
    {"name": "getCurrencyList", "display_name": "Currency List", "category": "currencies", "category_display": "Currencies", "library": "raw_v2", "cmd": "getCurrencyList", "params": []},

    # === Various (Dictionaries) ===
    {"name": "getReceptionTypes", "display_name": "Office Types", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getReceptionTypes", "params": []},
    {"name": "getMkt", "display_name": "Trading Platforms", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getMkt", "params": []},
    {"name": "getInstruments", "display_name": "Instruments", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getInstruments", "params": []},
    {"name": "getCPSTypesList", "display_name": "Request Types", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getCPSTypesList", "params": []},
    {"name": "getPassportType", "display_name": "Document Types", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getPassportType", "params": []},
    {"name": "getOrderStatuses", "display_name": "Order Statuses", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getOrderStatuses", "params": []},
    {"name": "getSafetyTypes", "display_name": "Signature Types", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getSafetyTypes", "params": []},
    {"name": "getTypeCodes", "display_name": "Valid Codes", "category": "various", "category_display": "Various (Dicts)", "library": "raw_v2", "cmd": "getTypeCodes", "params": []},

    # === Websocket (info only) ===
    {"name": "wsInfo", "display_name": "WebSocket Info", "category": "websocket", "category_display": "WebSocket", "library": "raw_v2", "cmd": "getWebSocketInfo", "params": []},

    # --- Raw API ---
    {"name": "raw_v2_custom", "display_name": "Raw API Command (V2)", "category": "advanced", "category_display": "Advanced", "library": "raw_v2", "cmd": "", "params": [
        {"name": "cmd", "type": "string", "required": True, "description": "API command name"},
        {"name": "params", "type": "json", "required": False, "default": "{}", "description": "JSON parameters"}
    ]},
]

def _api_auth_request(command, params, public_key, private_key, api_base="https://tradernet.am"):
    nonce = int(time.time() * 10000)

    def _flatten_params(data, root_name=''):
        result = []
        for key, value in sorted(data.items()):
            if isinstance(value, dict):
                result.extend(_flatten_params(value, key))
            else:
                full_key = f"{root_name}[{key}]" if root_name else key
                result.append(f"{full_key}={value}")
        return result

    def _to_query_string(data):
        parts = []
        for key, value in sorted(data.items()):
            if isinstance(value, dict):
                parts.append(f"{key}={_to_query_string(value)}")
            else:
                parts.append(f"{key}={value}")
        return "&".join(parts)

    api_data = {"cmd": command, "nonce": nonce, "apiKey": public_key}
    if params:
        api_data["params"] = params
    query_string = _to_query_string(api_data)
    signature = hmac.new(
        private_key.encode('utf-8'),
        query_string.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    body_str = "&".join(_flatten_params(api_data))
    headers = {
        'X-NtApi-Sig': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
    }
    url = f"{api_base}/api/v2/cmd/{command}"
    req = urllib.request.Request(url, data=body_str.encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="static", **kwargs)

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except Exception as e:
            log.error(f"Unhandled error on {self.path}: {e}", exc_info=True)
            try:
                self.send_json({'error': 'Internal server error'}, 500)
            except Exception:
                pass

    def send_response(self, code, message=None):
        super().send_response(code, message)
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate, private')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Strict-Transport-Security', 'max-age=31536000')

    def do_GET(self):
        _cleanup_sessions()
        # SPA routing: serve index.html for non-API frontend routes
        api_prefix = self.path.startswith('/api/')
        if not api_prefix:
            # Check if the requested file exists in static/ directory
            import os as os_module
            static_dir = os_module.path.join(os_module.path.dirname(os_module.path.abspath(__file__)), 'static')
            requested_file = os_module.path.join(static_dir, self.path.lstrip('/'))
            is_asset = os_module.path.exists(requested_file) and os_module.path.isfile(requested_file)

            if not is_asset:
                # SPA fallback: serve index.html for any frontend route
                self.path = '/index.html'
        
        # API Route: Get Wallets
        if self.path == '/api/wallets':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
            
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, name, api_key, login FROM wallets WHERE user_id = %s', (user['id'],))
            wallets = []
            enc_key = user.get('encryption_key')
            for row in c.fetchall():
                login_val = ''
                if enc_key and row[3]:
                    try:
                        login_val = Fernet(enc_key).decrypt(row[3].encode('utf-8')).decode('utf-8')
                    except Exception:
                        login_val = row[3]  # fallback for unencrypted data
                wallets.append({'id': row[0], 'name': row[1], 'api_key': row[2], 'login': login_val})
            close_db(conn)
            self.send_json({'wallets': wallets, 'totp_enabled': user['totp_enabled'] == 1})
            return

        # API Route: Get Commands Registry
        if self.path == '/api/commands':
            self.send_json(COMMANDS_REGISTRY)
            return

        # API Route: Get CSRF Token
        if self.path == '/api/csrf-token':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
            self.send_json({'csrfToken': user.get('csrf_token', '')})
            return

        # API Route: List Dictionaries
        if self.path == '/api/dictionaries':
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, code, name, description, endpoint, category, updated_at FROM api_dictionaries ORDER BY code')
            rows = c.fetchall()
            close_db(conn)
            dicts = [{'id': r[0], 'code': r[1], 'name': r[2], 'description': r[3], 'endpoint': r[4], 'category': r[5], 'updated_at': str(r[6])} for r in rows]
            self.send_json(dicts)
            return

        # API Route: Get Dictionary Entries
        if self.path.startswith('/api/dictionaries/'):
            code = self.path.split('/api/dictionaries/', 1)[1].split('?')[0]
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, code, name, description, endpoint, updated_at FROM api_dictionaries WHERE code = %s', (code,))
            dict_row = c.fetchone()
            if not dict_row:
                close_db(conn)
                self.send_json({'error': 'Dictionary not found'}, 404)
                return
            dict_id = dict_row[0]
            c.execute('SELECT id, entry_code, entry_name, entry_data FROM api_dictionary_entries WHERE dictionary_id = %s ORDER BY id', (dict_id,))
            entries = [{'id': r[0], 'code': r[1], 'name': r[2], 'data': r[3]} for r in c.fetchall()]
            close_db(conn)
            self.send_json({'dictionary': {'code': dict_row[1], 'name': dict_row[2], 'description': dict_row[3], 'endpoint': dict_row[4], 'updated_at': str(dict_row[5])}, 'entries': entries, 'count': len(entries)})
            return

        # API Route: Get Wallet Secret Key
        if self.path.startswith('/api/wallets/secret'):
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
            if not self._require_2fa_verified(user):
                return

            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            wallet_id = qs.get('id', [None])[0]
            if not wallet_id:
                self.send_json({'error': 'Missing wallet id'}, 400)
                return

            if not user.get('encryption_key'):
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return

            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT name, api_key, secret_key FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            wallet = c.fetchone()
            close_db(conn)

            if not wallet:
                self.send_json({'error': 'Wallet not found'}, 404)
                return

            try:
                f = Fernet(user['encryption_key'])
                decrypted = f.decrypt(wallet[2].encode('utf-8')).decode('utf-8')
                self.send_json({'name': wallet[0], 'api_key': wallet[1], 'secret_key': decrypted})
            except Exception:
                self.send_json({'error': 'Decryption failed'}, 500)
            return

        return super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)

        # CSRF check for all mutating API endpoints
        if self.path.startswith('/api/') and not self._check_csrf():
            return
        
        try:
            data = json.loads(post_data.decode('utf-8'))
        except json.JSONDecodeError:
            data = {}

        if self.path == '/api/auth/register':
            phone = data.get('phone')
            password = data.get('password')
            
            if phone and password:
                if len(password) < 8:
                    self.send_json({'error': 'Password must be at least 8 characters'}, 400)
                    return
                ok, remaining = self._check_brute_force(phone)
                if not ok:
                    self.send_json({'error': f'Account locked. Try again in {remaining} seconds.'}, 429)
                    return

                conn = get_db()
                c = conn.cursor()
                c.execute('SELECT id FROM users WHERE phone = %s', (phone,))
                if c.fetchone():
                    close_db(conn)
                    self.send_json({'error': 'Phone number already registered'}, 400)
                    return
                
                salt = os.urandom(16).hex()
                c.execute('INSERT INTO users (phone, password_hash, salt) VALUES (%s, %s, %s)', (phone, hash_password(password), salt))
                conn.commit()
                close_db(conn)
                self.send_json({'success': True, 'message': 'Account created'})
            else:
                self.send_json({'error': 'Phone and password required'}, 400)
                
        elif self.path == '/api/auth/login':
            phone = data.get('phone')
            password = data.get('password')
            
            if not phone or not password:
                self.send_json({'error': 'Phone and password required'}, 400)
                return

            ok, remaining = self._check_brute_force(phone)
            if not ok:
                self.send_json({'error': f'Account locked. Try again in {remaining} seconds.'}, 429)
                return

            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, password_hash, totp_enabled, salt FROM users WHERE phone = %s', (phone,))
            user = c.fetchone()
            close_db(conn)
            
            if user and check_password(password, user[1]):
                salt = user[3]
                if user[2] == 1:
                    # 2FA is enabled
                    self.send_json({'success': True, 'requires_2fa': True})
                else:
                    # No 2FA, log in immediately
                    self._login_user(phone, password, salt)
            else:
                self._record_failed_attempt(phone)
                self.send_json({'error': 'Invalid phone or password'}, 401)
                
        elif self.path == '/api/auth/verify-2fa':
            phone = data.get('phone')
            password = data.get('password')
            code = data.get('code')
            
            if not phone or not password or not code:
                self.send_json({'error': 'Missing data'}, 400)
                return

            ok, remaining = self._check_brute_force(phone)
            if not ok:
                self.send_json({'error': f'Account locked. Try again in {remaining} seconds.'}, 429)
                return
            
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, totp_secret, totp_enabled, password_hash, salt FROM users WHERE phone = %s', (phone,))
            user = c.fetchone()
            close_db(conn)
            
            if user and user[2] == 1 and check_password(password, user[3]) and user[1] and verify_totp(user[1], code):
                self._login_user(phone, password, user[4])
            else:
                self._record_failed_attempt(phone)
                self.send_json({'error': 'Invalid code or password'}, 401)
                
        elif self.path == '/api/auth/reverify-2fa':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return

            code = data.get('code')
            if not code:
                self.send_json({'error': 'Missing 2FA code'}, 400)
                return

            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT totp_secret FROM users WHERE id = %s', (user['id'],))
            row = c.fetchone()
            close_db(conn)

            if row and row[0] and verify_totp(row[0], code):
                token = SimpleCookie(self.headers.get('Cookie', '')).get('session_token').value if 'Cookie' in self.headers else None
                if token and token in IN_MEMORY_SESSIONS:
                    IN_MEMORY_SESSIONS[token]['2fa_verified_at'] = time.time()
                self.send_json({'success': True, 'message': '2FA verified'})
            else:
                self.send_json({'error': 'Invalid code'}, 401)

        elif self.path == '/api/auth/setup-2fa':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
                
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT totp_secret, totp_enabled, phone FROM users WHERE id = %s', (user['id'],))
            row = c.fetchone()
            
            if row[1] == 1:
                close_db(conn)
                self.send_json({'error': '2FA is already enabled'}, 400)
                return
                
            totp_secret = row[0]
            if not totp_secret:
                totp_secret = generate_totp_secret()
                c.execute('UPDATE users SET totp_secret = %s WHERE id = %s', (totp_secret, user['id']))
                conn.commit()
                
            close_db(conn)
            
            app_name = urllib.parse.quote("Tradernet Dashboard")
            phone_encoded = urllib.parse.quote(row[2])
            uri = f"otpauth://totp/{app_name}:{phone_encoded}?secret={totp_secret}&issuer={app_name}"
            
            self.send_json({'setupUri': uri})
            
        elif self.path == '/api/auth/confirm-2fa':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
                
            code = data.get('code')
            
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT totp_secret FROM users WHERE id = %s', (user['id'],))
            row = c.fetchone()
            
            if row and row[0] and verify_totp(row[0], code):
                c.execute('UPDATE users SET totp_enabled = 1 WHERE id = %s', (user['id'],))
                conn.commit()
                close_db(conn)
                self.send_json({'success': True})
            else:
                close_db(conn)
                self.send_json({'error': 'Invalid code'}, 400)
                
        elif self.path == '/api/auth/logout':
            user = self.get_user_from_session()
            if user:
                token = SimpleCookie(self.headers.get('Cookie', '')).get('session_token')
                if token:
                    token_val = token.value
                    IN_MEMORY_SESSIONS.pop(token_val, None)
                conn = get_db()
                c = conn.cursor()
                c.execute('UPDATE users SET session_token = NULL WHERE id = %s', (user['id'],))
                conn.commit()
                close_db(conn)
                log.info(f"User {user.get('phone')} logged out")
            cookie = SimpleCookie()
            cookie['session_token'] = ''
            cookie['session_token']['path'] = '/'
            cookie['session_token']['expires'] = 'Thu, 01 Jan 1970 00:00:00 GMT'
            cookie['session_token']['httponly'] = True
            cookie['session_token']['samesite'] = 'Strict'
            cookie['session_token']['secure'] = True
            self.send_json({'success': True, 'message': 'Logged out'})

        elif self.path == '/api/wallets':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
                
            if user['totp_enabled'] != 1:
                self.send_json({'error': '2FA must be enabled to connect a wallet'}, 403)
                return
                
            name = data.get('name', 'My Wallet')
            api_key = data.get('apiKey')
            secret_key = data.get('secretKey')
            login = data.get('login', '')
            password = data.get('password', '')

            if login and not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', login):
                self.send_json({'error': 'Invalid email format for login'}, 400)
                return
            
            if not user.get('encryption_key'):
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return
            
            if api_key and secret_key:
                f = Fernet(user['encryption_key'])
                encrypted_secret = f.encrypt(secret_key.encode('utf-8')).decode('utf-8')
                encrypted_login = f.encrypt(login.encode('utf-8')).decode('utf-8') if login else ''
                encrypted_password = f.encrypt(password.encode('utf-8')).decode('utf-8') if password else ''

                conn = get_db()
                c = conn.cursor()
                c.execute('INSERT INTO wallets (user_id, name, api_key, secret_key, login, password) VALUES (%s, %s, %s, %s, %s, %s)', 
                          (user['id'], name, api_key, encrypted_secret, encrypted_login, encrypted_password))
                conn.commit()
                close_db(conn)
                self.send_json({'success': True})
            else:
                self.send_json({'error': 'Missing keys'}, 400)
                
        elif self.path == '/api/tradernet':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return

            wallet_id = data.get('walletId')
            cmd = data.get('cmd')
            params = data.get('params', {})
            
            if not wallet_id or not cmd:
                self.send_json({'error': 'Missing walletId or cmd'}, 400)
                return

            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT api_key, secret_key FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            wallet = c.fetchone()
            close_db(conn)

            if not wallet:
                self.send_json({'error': 'Wallet not found'}, 404)
                return

            if not user.get('encryption_key'):
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return

            public_key = wallet[0]
            try:
                f = Fernet(user['encryption_key'])
                private_key = f.decrypt(wallet[1].encode('utf-8')).decode('utf-8')
            except Exception:
                self.send_json({'error': 'Decryption failed'}, 500)
                return

            try:
                result = _api_auth_request(cmd, params, public_key, private_key)
                self.send_json(result)
            except urllib.error.HTTPError as e:
                try:
                    error_res = json.loads(e.read().decode('utf-8'))
                    self.send_json(error_res, e.code)
                except:
                    self.send_json({'error': f'Tradernet API Error: {e.code}'}, e.code)
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
        elif self.path == '/api/tradernet-hybrid':
            # New endpoint for hybrid Tradernet functionality
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return

            wallet_id = data.get('walletId')
            operation = data.get('operation')
            
            if not wallet_id or not operation:
                self.send_json({'error': 'Missing walletId or operation'}, 400)
                return

            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT api_key, secret_key FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            wallet = c.fetchone()
            close_db(conn)

            if not wallet:
                self.send_json({'error': 'Wallet not found'}, 404)
                return

            if not user.get('encryption_key'):
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return

            try:
                f = Fernet(user['encryption_key'])
                private_key = f.decrypt(wallet[1].encode('utf-8')).decode('utf-8')
                
                # Create TradeManager instance for hybrid operations
                trade_manager = TradeManager(
                    public_key=wallet[0],
                    private_key=private_key
                )
                
                if operation == 'get_quotes':
                    ticker = data.get('ticker', 'AAPL.US')
                    result = trade_manager.get_quotes(ticker)
                    self.send_json(result)
                elif operation == 'send_order':
                    ticker = data.get('ticker', 'AAPL.US')
                    side = data.get('side', 'buy')
                    count = data.get('count', 1)
                    result = trade_manager.send_order(ticker=ticker, side=side, count=count)
                    self.send_json(result)
                elif operation == 'set_stop_loss_take_profit':
                    ticker = data.get('ticker', 'AAPL.US')
                    stop_loss = data.get('stop_loss')
                    take_profit = data.get('take_profit')
                    result = trade_manager.set_stop_loss_take_profit(
                        ticker=ticker,
                        stop_loss=stop_loss,
                        take_profit=take_profit
                    )
                    self.send_json(result)
                else:
                    self.send_json({'error': 'Invalid operation'}, 400)
                    
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
        elif self.path == '/api/wallet-command':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return

            wallet_id = data.get('walletId')
            command_name = data.get('command')
            cmd_params = data.get('params', {})

            if not wallet_id or not command_name:
                self.send_json({'error': 'Missing walletId or command'}, 400)
                return

            command_def = None
            for cmd in COMMANDS_REGISTRY:
                if cmd['name'] == command_name:
                    command_def = cmd
                    break

            if not command_def:
                self.send_json({'error': f'Unknown command: {command_name}'}, 400)
                return

            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT api_key, secret_key FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            wallet = c.fetchone()
            close_db(conn)

            if not wallet:
                self.send_json({'error': 'Wallet not found'}, 404)
                return

            if not user.get('encryption_key'):
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return

            public_key = wallet[0]
            try:
                f = Fernet(user['encryption_key'])
                private_key = f.decrypt(wallet[1].encode('utf-8')).decode('utf-8')
            except Exception:
                self.send_json({'error': 'Decryption failed'}, 500)
                return

            try:
                library = command_def['library']
                if library == 'tradernet_api':
                    if not ThirdPartyAPI:
                        self.send_json({'error': 'Third-party API not available'}, 500)
                        return
                    api = ThirdPartyAPI(api_key=public_key, secret_key=private_key)
                    method = getattr(api, command_def['method'])
                    result = method(**cmd_params)
                    self.send_json(result)

                elif library == 'raw_v2':
                    if command_def.get('cmd'):
                        cmd = command_def['cmd']
                        raw_params = cmd_params
                    else:
                        cmd = cmd_params.get('cmd', '')
                        raw_params = cmd_params.get('params', {})

                    if not cmd:
                        self.send_json({'error': 'cmd is required for raw_v2'}, 400)
                        return

                    result = _api_auth_request(cmd, raw_params, public_key, private_key)
                    self.send_json(result)

                else:
                    self.send_json({'error': f'Unknown library: {library}'}, 500)

            except urllib.error.HTTPError as e:
                try:
                    error_res = json.loads(e.read().decode('utf-8'))
                    self.send_json(error_res, e.code)
                except:
                    self.send_json({'error': f'API Error: {e.code}'}, e.code)
            except Exception as e:
                self.send_json({'error': str(e)}, 500)

        elif self.path.startswith('/api/dictionaries/') and self.path.endswith('/refresh'):
            code = self.path.split('/api/dictionaries/', 1)[1].rsplit('/refresh', 1)[0]
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return

            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, endpoint FROM api_dictionaries WHERE code = %s', (code,))
            dict_row = c.fetchone()
            if not dict_row:
                close_db(conn)
                self.send_json({'error': 'Dictionary not found'}, 404)
                return

            dict_id = dict_row[0]
            endpoint_cmd = dict_row[1]

            wallet_id = data.get('walletId')
            if not wallet_id:
                close_db(conn)
                self.send_json({'error': 'walletId required'}, 400)
                return

            c.execute('SELECT api_key, secret_key FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            wallet = c.fetchone()
            if not wallet:
                close_db(conn)
                self.send_json({'error': 'Wallet not found'}, 404)
                return

            if not user.get('encryption_key'):
                close_db(conn)
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return

            try:
                f = Fernet(user['encryption_key'])
                private_key = f.decrypt(wallet[1].encode('utf-8')).decode('utf-8')
                public_key = wallet[0]

                result = _api_auth_request(endpoint_cmd, {}, public_key, private_key)

                c.execute('DELETE FROM api_dictionary_entries WHERE dictionary_id = %s', (dict_id,))
                entries_added = 0
                if isinstance(result, list):
                    for item in result:
                        if isinstance(item, dict):
                            entry_code = str(item.get('code', item.get('id', '')))
                            entry_name = str(item.get('name', item.get('title', '')))
                            entry_data = json.dumps(item)
                        else:
                            entry_code = str(item)
                            entry_name = str(item)
                            entry_data = json.dumps({'value': str(item)})
                        c.execute(
                            'INSERT INTO api_dictionary_entries (dictionary_id, entry_code, entry_name, entry_data) VALUES (%s, %s, %s, %s)',
                            (dict_id, entry_code, entry_name, entry_data)
                        )
                        entries_added += 1
                elif isinstance(result, dict):
                    for key, value in result.items():
                        if isinstance(value, dict):
                            entry_code = str(key)
                            entry_name = str(value.get('name', key))
                            entry_data = json.dumps(value)
                        else:
                            entry_code = str(key)
                            entry_name = str(value)
                            entry_data = json.dumps({'value': str(value)})
                        c.execute(
                            'INSERT INTO api_dictionary_entries (dictionary_id, entry_code, entry_name, entry_data) VALUES (%s, %s, %s, %s)',
                            (dict_id, entry_code, entry_name, entry_data)
                        )
                        entries_added += 1

                c.execute('UPDATE api_dictionaries SET updated_at = CURRENT_TIMESTAMP WHERE id = %s', (dict_id,))
                conn.commit()
                close_db(conn)
                self.send_json({'success': True, 'entries': entries_added})
            except Exception as e:
                close_db(conn)
                self.send_json({'error': str(e)}, 500)
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        # CSRF check for all mutating API endpoints
        if self.path.startswith('/api/') and not self._check_csrf():
            return

        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
            except json.JSONDecodeError:
                data = {}
        else:
            data = {}

        if self.path == '/api/wallets':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
            
            wallet_id = data.get('id')
            if not wallet_id:
                self.send_json({'error': 'Missing wallet ID'}, 400)
                return
            
            conn = get_db()
            c = conn.cursor()
            c.execute('DELETE FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            conn.commit()
            deleted = c.rowcount
            close_db(conn)
            
            if deleted > 0:
                self.send_json({'success': True})
            else:
                self.send_json({'error': 'Wallet not found'}, 404)
        else:
            self.send_response(404)
            self.end_headers()

    def _check_csrf(self):
        """Validate CSRF token. Returns True if valid, sends error and returns False otherwise."""
        user = self.get_user_from_session()
        if not user:
            return True  # Let the auth check handle 401
        # Exempt auth endpoints that establish or validate sessions
        if self.path in ('/api/auth/login', '/api/auth/register', '/api/auth/verify-2fa', '/api/auth/logout'):
            return True
        token = self.headers.get('X-CSRF-Token', '')
        expected = user.get('csrf_token', '')
        if not token or not expected:
            self.send_json({'error': 'CSRF token missing'}, 403)
            return False
        if not hmac.compare_digest(token, expected):
            self.send_json({'error': 'Invalid CSRF token'}, 403)
            return False
        return True

    def _record_failed_attempt(self, phone):
        """Increment failed_attempts and lock if threshold exceeded."""
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT failed_attempts FROM users WHERE phone = %s FOR UPDATE', (phone,))
        row = c.fetchone()
        if row:
            attempts = (row[0] or 0) + 1
            if attempts >= BRUTE_FORCE_MAX_ATTEMPTS:
                c.execute("UPDATE users SET failed_attempts = %s, locked_until = NOW() + interval '%s minutes' WHERE phone = %s",
                          (attempts, BRUTE_FORCE_LOCKOUT_MINUTES, phone))
            else:
                c.execute('UPDATE users SET failed_attempts = %s WHERE phone = %s', (attempts, phone))
            conn.commit()
            time.sleep(min(attempts * 0.5, 3))
        close_db(conn)

    def _check_brute_force(self, phone):
        """Check if account is locked. Returns (ok, lock_seconds_remaining)."""
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT locked_until FROM users WHERE phone = %s', (phone,))
        row = c.fetchone()
        close_db(conn)
        if row and row[0]:
            remaining = (row[0].timestamp() - time.time())
            if remaining > 0:
                return False, int(remaining)
        return True, 0

    def _require_2fa_verified(self, user):
        now = time.time()
        last = user.get('2fa_verified_at')
        if last is None or (now - last) > TFA_VERIFY_TIMEOUT:
            self.send_json({'error': '2FA verification required', 'code': '2FA_REQUIRED'}, 401)
            return False
        return True

    def do_PUT(self):
        # CSRF check for all mutating API endpoints
        if self.path.startswith('/api/') and not self._check_csrf():
            return

        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            put_data = self.rfile.read(content_length)
            try:
                data = json.loads(put_data.decode('utf-8'))
            except json.JSONDecodeError:
                data = {}
        else:
            data = {}

        if self.path == '/api/wallets':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return

            if not self._require_2fa_verified(user):
                return

            wallet_id = data.get('id')
            name = data.get('name')
            api_key = data.get('apiKey')
            secret_key = data.get('secretKey')
            login = data.get('login')
            password = data.get('password')

            if login and not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', login):
                self.send_json({'error': 'Invalid email format for login'}, 400)
                return

            if not wallet_id:
                self.send_json({'error': 'Missing wallet ID'}, 400)
                return

            if not user.get('encryption_key'):
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return

            updates = []
            values = []
            if name is not None:
                updates.append('name = %s')
                values.append(name)
            if api_key is not None:
                updates.append('api_key = %s')
                values.append(api_key)
            if secret_key is not None:
                f = Fernet(user['encryption_key'])
                encrypted = f.encrypt(secret_key.encode('utf-8')).decode('utf-8')
                updates.append('secret_key = %s')
                values.append(encrypted)
            if login is not None:
                f = Fernet(user['encryption_key'])
                updates.append('login = %s')
                values.append(f.encrypt(login.encode('utf-8')).decode('utf-8') if login else '')
            if password is not None:
                f = Fernet(user['encryption_key'])
                updates.append('password = %s')
                values.append(f.encrypt(password.encode('utf-8')).decode('utf-8') if password else '')

            if not updates:
                self.send_json({'error': 'Nothing to update'}, 400)
                return

            values.append(wallet_id)
            values.append(user['id'])

            conn = get_db()
            c = conn.cursor()
            sql = f"UPDATE wallets SET {', '.join(updates)} WHERE id = %s AND user_id = %s"
            c.execute(sql, values)
            conn.commit()
            updated = c.rowcount
            close_db(conn)

            if updated > 0:
                self.send_json({'success': True, 'message': 'Wallet updated'})
            else:
                self.send_json({'error': 'Wallet not found'}, 404)
        else:
            self.send_response(404)
            self.end_headers()

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _login_user(self, phone, password, salt):
        """Helper to create session, derive key and return success."""
        # Derive key
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=bytes.fromhex(salt),
            iterations=390000,
        )
        encryption_key = base64.urlsafe_b64encode(kdf.derive(password.encode('utf-8')))

        csrf_token = base64.urlsafe_b64encode(os.urandom(CSRF_TOKEN_BYTES)).decode('utf-8')
        session_token = str(uuid.uuid4())
        IN_MEMORY_SESSIONS[session_token] = {
            'encryption_key': encryption_key,
            '2fa_verified_at': None,
            'csrf_token': csrf_token,
            'created_at': time.time(),
        }

        conn = get_db()
        c = conn.cursor()
        c.execute('UPDATE users SET session_token = %s, failed_attempts = 0, locked_until = NULL WHERE phone = %s', (session_token, phone))
        conn.commit()
        close_db(conn)

        cookie = SimpleCookie()
        cookie['session_token'] = session_token
        cookie['session_token']['path'] = '/'
        cookie['session_token']['httponly'] = True
        cookie['session_token']['samesite'] = 'Strict'
        cookie['session_token']['secure'] = True

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Set-Cookie', cookie.output(header='', sep=''))
        self.end_headers()
        self.wfile.write(json.dumps({'success': True}).encode())

    def get_user_from_session(self):
        if 'Cookie' in self.headers:
            cookie = SimpleCookie(self.headers.get('Cookie'))
            if 'session_token' in cookie:
                token = cookie['session_token'].value
                conn = get_db()
                c = conn.cursor()
                c.execute('SELECT id, phone, totp_enabled, failed_attempts, locked_until FROM users WHERE session_token = %s', (token,))
                user = c.fetchone()
                close_db(conn)
                if user:
                    session_data = IN_MEMORY_SESSIONS.get(token, {})
                    return {
                        'id': user[0],
                        'phone': user[1],
                        'totp_enabled': user[2],
                        'failed_attempts': user[3],
                        'locked_until': user[4],
                        'encryption_key': session_data.get('encryption_key'),
                        '2fa_verified_at': session_data.get('2fa_verified_at'),
                        'csrf_token': session_data.get('csrf_token'),
                    }
        return None

if __name__ == "__main__":
    import ssl as _ssl_mod
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True

        cert_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
        cert_file = os.path.join(cert_dir, 'cert.pem')
        key_file = os.path.join(cert_dir, 'key.pem')

        if os.path.exists(cert_file) and os.path.exists(key_file):
            ctx = _ssl_mod.SSLContext(_ssl_mod.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(cert_file, key_file)
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
            print(f"HTTPS server running at https://localhost:{PORT}")
        else:
            print(f"WARNING: certs not found, running HTTP at http://localhost:{PORT}")

        httpd.serve_forever()