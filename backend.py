import http.server
import socketserver
import threading
import json
import os
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
import bcrypt
import psycopg2
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# Import Tradernet modules for hybrid system
try:
    from tradernet import Tradernet as OfficialSDK
    from tradernet_api.api import API as ThirdPartyAPI
except ImportError:
    OfficialSDK = None
    ThirdPartyAPI = None

IN_MEMORY_SESSIONS = {}
TFA_VERIFY_TIMEOUT = 300  # 5 minutes

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

PORT = 8000

# PostgreSQL configuration (use environment variables with defaults)
DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_PORT = int(os.environ.get('DB_PORT', 5432))
DB_NAME = os.environ.get('DB_NAME', 'tradernet')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASSWORD = os.environ.get('DB_PASSWORD', 'postgres')

def get_db():
    """Get a new PostgreSQL database connection."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )

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
    conn.commit()
    conn.close()

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
    # --- Market Data ---
    {"name": "getSecurityInfo", "display_name": "Ticker Info", "category": "market_data", "category_display": "Market Data", "library": "raw_v2", "cmd": "getSecurityInfo", "params": [
        {"name": "symbol", "type": "string", "required": True, "description": "Ticker symbol (e.g. AAPL.US)"},
        {"name": "sup", "type": "bool", "required": False, "default": True, "description": "Extended info format"}
    ]},
    {"name": "getMarketStatus", "display_name": "Market Status", "category": "market_data", "category_display": "Market Data", "library": "raw_v2", "cmd": "getMarketStatus", "params": [
        {"name": "market", "type": "string", "required": False, "default": "*", "description": "Market code"}
    ]},
    # --- User Data ---
    {"name": "getOPQ", "display_name": "User Info (OPQ)", "category": "portfolio", "category_display": "Portfolio", "library": "raw_v2", "cmd": "getOPQ", "params": []},
    # --- Orders ---
    {"name": "putTradeOrder", "display_name": "Send Order", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "putTradeOrder", "params": [
        {"name": "instr_name", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "side", "type": "string", "required": True, "description": "buy / sell"},
        {"name": "qty", "type": "int", "required": True, "description": "Quantity"},
        {"name": "market_order", "type": "bool", "required": False, "default": True, "description": "Market order"},
        {"name": "limit_price", "type": "float", "required": False, "default": 0, "description": "Limit price"},
        {"name": "stop_price", "type": "float", "required": False, "default": 0, "description": "Stop price"},
        {"name": "expiry", "type": "string", "required": False, "default": "day", "description": "day / ext / gtc"}
    ]},
    {"name": "getNotifyOrderJson", "display_name": "Get Orders", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "getNotifyOrderJson", "params": [
        {"name": "active_only", "type": "bool", "required": False, "default": True, "description": "Show only active orders"}
    ]},
    {"name": "delTradeOrder", "display_name": "Delete Order", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "delTradeOrder", "params": [
        {"name": "order_id", "type": "string", "required": True, "description": "Order ID to delete"}
    ]},
    {"name": "putStopLoss", "display_name": "Stop Loss / Take Profit", "category": "orders", "category_display": "Orders", "library": "raw_v2", "cmd": "putStopLoss", "params": [
        {"name": "ticker", "type": "string", "required": True, "description": "Ticker symbol"},
        {"name": "stop_loss", "type": "float", "required": False, "default": 0, "description": "Stop loss price"},
        {"name": "take_profit", "type": "float", "required": False, "default": 0, "description": "Take profit price"}
    ]},
    # --- Raw API ---
    {"name": "raw_v2_custom", "display_name": "Raw API Command (V2)", "category": "advanced", "category_display": "Advanced", "library": "raw_v2", "cmd": "", "params": [
        {"name": "cmd", "type": "string", "required": True, "description": "API command name (e.g. getSecurityInfo, getMarketStatus, getOPQ, putTradeOrder, getNotifyOrderJson, delTradeOrder, putStopLoss)"},
        {"name": "params", "type": "json", "required": False, "default": "{}", "description": "JSON parameters"}
    ]},
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="static", **kwargs)

    def send_response(self, code, message=None):
        super().send_response(code, message)
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')

    def do_GET(self):
        # Basic routing for static pages
        if self.path == '/':
            self.path = '/index.html'
        elif self.path == '/dashboard':
            self.path = '/dashboard.html'
        
        # API Route: Get Wallets
        if self.path == '/api/wallets':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
            
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, name, api_key, login FROM wallets WHERE user_id = %s', (user['id'],))
            wallets = [{'id': row[0], 'name': row[1], 'api_key': row[2], 'login': row[3] or ''} for row in c.fetchall()]
            conn.close()
            self.send_json({'wallets': wallets, 'totp_enabled': user['totp_enabled'] == 1})
            return

        # API Route: Get Commands Registry
        if self.path == '/api/commands':
            self.send_json(COMMANDS_REGISTRY)
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
            conn.close()

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
        
        try:
            data = json.loads(post_data.decode('utf-8'))
        except json.JSONDecodeError:
            data = {}

        if self.path == '/api/auth/register':
            phone = data.get('phone')
            password = data.get('password')
            
            if phone and password:
                conn = get_db()
                c = conn.cursor()
                c.execute('SELECT id FROM users WHERE phone = %s', (phone,))
                if c.fetchone():
                    conn.close()
                    self.send_json({'error': 'Phone number already registered'}, 400)
                    return
                
                salt = os.urandom(16).hex()
                c.execute('INSERT INTO users (phone, password_hash, salt) VALUES (%s, %s, %s)', (phone, hash_password(password), salt))
                conn.commit()
                conn.close()
                self.send_json({'success': True, 'message': 'Account created'})
            else:
                self.send_json({'error': 'Phone and password required'}, 400)
                
        elif self.path == '/api/auth/login':
            phone = data.get('phone')
            password = data.get('password')
            
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, password_hash, totp_enabled, salt FROM users WHERE phone = %s', (phone,))
            user = c.fetchone()
            conn.close()
            
            if user and check_password(password, user[1]):
                salt = user[3]
                if user[2] == 1:
                    # 2FA is enabled
                    self.send_json({'success': True, 'requires_2fa': True})
                else:
                    # No 2FA, log in immediately
                    self._login_user(phone, password, salt)
            else:
                self.send_json({'error': 'Invalid phone or password'}, 401)
                
        elif self.path == '/api/auth/verify-2fa':
            phone = data.get('phone')
            password = data.get('password')
            code = data.get('code')
            
            if not phone or not password or not code:
                self.send_json({'error': 'Missing data'}, 400)
                return
            
            conn = get_db()
            c = conn.cursor()
            c.execute('SELECT id, totp_secret, totp_enabled, password_hash, salt FROM users WHERE phone = %s', (phone,))
            user = c.fetchone()
            conn.close()
            
            if user and user[2] == 1 and check_password(password, user[3]) and user[1] and verify_totp(user[1], code):
                self._login_user(phone, password, user[4])
            else:
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
            conn.close()

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
                conn.close()
                self.send_json({'error': '2FA is already enabled'}, 400)
                return
                
            totp_secret = row[0]
            if not totp_secret:
                totp_secret = generate_totp_secret()
                c.execute('UPDATE users SET totp_secret = %s WHERE id = %s', (totp_secret, user['id']))
                conn.commit()
                
            conn.close()
            
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
                conn.close()
                self.send_json({'success': True})
            else:
                conn.close()
                self.send_json({'error': 'Invalid code'}, 400)
                
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
            
            if not user.get('encryption_key'):
                self.send_json({'error': 'Encryption key missing, please re-login'}, 401)
                return
            
            if api_key and secret_key:
                f = Fernet(user['encryption_key'])
                encrypted_secret = f.encrypt(secret_key.encode('utf-8')).decode('utf-8')

                conn = get_db()
                c = conn.cursor()
                c.execute('INSERT INTO wallets (user_id, name, api_key, secret_key, login, password) VALUES (%s, %s, %s, %s, %s, %s)', 
                          (user['id'], name, api_key, encrypted_secret, login, password))
                conn.commit()
                conn.close()
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
            c.execute('SELECT api_key, secret_key, login, password FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            wallet = c.fetchone()
            conn.close()

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

            wallet_login = wallet[2] or ''
            wallet_password = wallet[3] or ''

            api_base = "https://tradernet.am"

            def v1_request(command, sid, req_params):
                """Make v1 API call with SID auth."""
                payload = json.dumps({"cmd": command, "SID": sid, "params": req_params})
                req = urllib.request.Request(
                    f"{api_base}/api/",
                    data=f"q={urllib.parse.quote(payload)}".encode('utf-8'),
                    method='POST'
                )
                with urllib.request.urlopen(req) as resp:
                    return json.loads(resp.read().decode('utf-8'))

            def v2_request(command, req_params):
                """Make v2 API call with apiKey+nonce+signature."""
                nonce = int(time.time() * 10000)

                def flatten_params(data, root_name=''):
                    result = []
                    for key, value in sorted(data.items()):
                        if isinstance(value, dict):
                            result.extend(flatten_params(value, key))
                        else:
                            full_key = f"{root_name}[{key}]" if root_name else key
                            result.append(f"{full_key}={value}")
                    return result

                def to_query_string(data):
                    parts = []
                    for key, value in sorted(data.items()):
                        if isinstance(value, dict):
                            parts.append(f"{key}={to_query_string(value)}")
                        else:
                            parts.append(f"{key}={value}")
                    return "&".join(parts)

                api_data = {"cmd": command, "nonce": nonce, "apiKey": public_key}
                if req_params:
                    api_data["params"] = req_params

                query_string = to_query_string(api_data)
                signature = hmac.new(
                    private_key.encode('utf-8'),
                    query_string.encode('utf-8'),
                    hashlib.sha256
                ).hexdigest()

                body_parts = flatten_params(api_data)
                body_str = "&".join(body_parts)

                headers = {
                    'X-NtApi-Sig': signature,
                    'Content-Type': 'application/x-www-form-urlencoded',
                }

                req = urllib.request.Request(
                    f"{api_base}/api/v2/cmd/{urllib.parse.quote(command, safe='')}",
                    data=body_str.encode('utf-8'),
                    headers=headers,
                    method='POST'
                )
                with urllib.request.urlopen(req) as resp:
                    return json.loads(resp.read().decode('utf-8'))

            def v1_auth_and_request(command, req_params):
                """Authenticate with login/password via v1 API, then make request."""
                # Step 1: authByLogin
                auth_payload = json.dumps({
                    "cmd": "authByLogin",
                    "params": {
                        "login": wallet_login,
                        "password": wallet_password,
                        "rememberMe": 1
                    }
                })
                auth_req = urllib.request.Request(
                    f"{api_base}/api/",
                    data=f"q={urllib.parse.quote(auth_payload)}".encode('utf-8'),
                    method='POST'
                )
                with urllib.request.urlopen(auth_req) as auth_resp:
                    auth_data = json.loads(auth_resp.read().decode('utf-8'))

                if not auth_data.get('SID'):
                    raise Exception(f"Auth failed: {auth_data.get('errMsg', 'No SID')}")

                # Step 2: make the actual request with SID
                return v1_request(command, auth_data['SID'], req_params)

            try:
                if wallet_login and wallet_password:
                    result = v1_auth_and_request(cmd, params)
                else:
                    result = v2_request(cmd, params)
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
            conn.close()

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
            c.execute('SELECT api_key, secret_key, login, password FROM wallets WHERE id = %s AND user_id = %s', (wallet_id, user['id']))
            wallet = c.fetchone()
            conn.close()

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

            wallet_login = wallet[2] or ''
            wallet_password = wallet[3] or ''
            api_base = "https://tradernet.am"

            def _v1_request(v1_cmd, sid, req_params):
                payload = json.dumps({"cmd": v1_cmd, "SID": sid, "params": req_params})
                req = urllib.request.Request(
                    f"{api_base}/api/",
                    data=f"q={urllib.parse.quote(payload)}".encode('utf-8'),
                    method='POST'
                )
                with urllib.request.urlopen(req) as resp:
                    return json.loads(resp.read().decode('utf-8'))

            def _v2_request(v2_cmd, req_params):
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
                api_data = {"cmd": v2_cmd, "nonce": nonce, "apiKey": public_key}
                if req_params:
                    api_data["params"] = req_params
                query_string = _to_query_string(api_data)
                signature = hmac.new(private_key.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
                body_str = "&".join(_flatten_params(api_data))
                headers = {'X-NtApi-Sig': signature, 'Content-Type': 'application/x-www-form-urlencoded'}
                req = urllib.request.Request(
                    f"{api_base}/api/v2/cmd/{urllib.parse.quote(v2_cmd, safe='')}",
                    data=body_str.encode('utf-8'), headers=headers, method='POST'
                )
                with urllib.request.urlopen(req) as resp:
                    return json.loads(resp.read().decode('utf-8'))

            def _v1_auth_and_request(v1_cmd, req_params):
                auth_payload = json.dumps({
                    "cmd": "authByLogin",
                    "params": {"login": wallet_login, "password": wallet_password, "rememberMe": 1}
                })
                auth_req = urllib.request.Request(
                    f"{api_base}/api/",
                    data=f"q={urllib.parse.quote(auth_payload)}".encode('utf-8'),
                    method='POST'
                )
                with urllib.request.urlopen(auth_req) as auth_resp:
                    auth_data = json.loads(auth_resp.read().decode('utf-8'))
                if not auth_data.get('SID'):
                    raise Exception(f"Auth failed: {auth_data.get('errMsg', 'No SID')}")
                return _v1_request(v1_cmd, auth_data['SID'], req_params)

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

                    if wallet_login and wallet_password:
                        result = _v1_auth_and_request(cmd, raw_params)
                    else:
                        result = _v2_request(cmd, raw_params)
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
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
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
            conn.close()
            
            if deleted > 0:
                self.send_json({'success': True})
            else:
                self.send_json({'error': 'Wallet not found'}, 404)
        else:
            self.send_response(404)
            self.end_headers()

    def _require_2fa_verified(self, user):
        now = time.time()
        last = user.get('2fa_verified_at')
        if last is None or (now - last) > TFA_VERIFY_TIMEOUT:
            self.send_json({'error': '2FA verification required', 'code': '2FA_REQUIRED'}, 401)
            return False
        return True

    def do_PUT(self):
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
                updates.append('login = %s')
                values.append(login)
            if password is not None:
                updates.append('password = %s')
                values.append(password)

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
            conn.close()

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
        
        session_token = str(uuid.uuid4())
        IN_MEMORY_SESSIONS[session_token] = {'encryption_key': encryption_key, '2fa_verified_at': None}

        conn = get_db()
        c = conn.cursor()
        c.execute('UPDATE users SET session_token = %s WHERE phone = %s', (session_token, phone))
        conn.commit()
        conn.close()
        
        cookie = SimpleCookie()
        cookie['session_token'] = session_token
        cookie['session_token']['path'] = '/'
        cookie['session_token']['httponly'] = True
        
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
                c.execute('SELECT id, phone, totp_enabled FROM users WHERE session_token = %s', (token,))
                user = c.fetchone()
                conn.close()
                if user:
                    session_data = IN_MEMORY_SESSIONS.get(token, {})
                    return {
                        'id': user[0],
                        'phone': user[1],
                        'totp_enabled': user[2],
                        'encryption_key': session_data.get('encryption_key'),
                        '2fa_verified_at': session_data.get('2fa_verified_at'),
                    }
        return None

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        print(f"Serving at port {PORT}")
        httpd.serve_forever()