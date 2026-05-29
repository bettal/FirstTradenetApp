import http.server
import socketserver
import sqlite3
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
import random

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
DB_FILE = 'db.sqlite'

# Initialize DB
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE,
            session_token TEXT,
            totp_secret TEXT
        )
    ''')
    try:
        c.execute('ALTER TABLE users ADD COLUMN totp_secret TEXT')
    except sqlite3.OperationalError:
        pass # Column already exists
    c.execute('''
        CREATE TABLE IF NOT EXISTS wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="static", **kwargs)

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
            
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('SELECT id, name, api_key FROM wallets WHERE user_id = ?', (user['id'],))
            wallets = [{'id': row[0], 'name': row[1], 'api_key': row[2]} for row in c.fetchall()]
            conn.close()
            self.send_json({'wallets': wallets})
            return

        return super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8'))
        except json.JSONDecodeError:
            data = {}

        if self.path == '/api/auth/send-code':
            phone = data.get('phone')
            if phone:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT totp_secret FROM users WHERE phone = ?', (phone,))
                user = c.fetchone()
                
                is_new_user = False
                totp_secret = None
                
                if not user:
                    totp_secret = generate_totp_secret()
                    c.execute('INSERT INTO users (phone, totp_secret) VALUES (?, ?)', (phone, totp_secret))
                    is_new_user = True
                elif not user[0]:
                    totp_secret = generate_totp_secret()
                    c.execute('UPDATE users SET totp_secret = ? WHERE phone = ?', (totp_secret, phone))
                    is_new_user = True
                else:
                    totp_secret = user[0]
                    
                conn.commit()
                conn.close()
                
                response_data = {'success': True}
                if is_new_user:
                    # Provide provisioning URI for QR code generation on the client
                    app_name = urllib.parse.quote("Tradernet Dashboard")
                    phone_encoded = urllib.parse.quote(phone)
                    uri = f"otpauth://totp/{app_name}:{phone_encoded}?secret={totp_secret}&issuer={app_name}"
                    response_data['setupRequired'] = True
                    response_data['setupUri'] = uri
                else:
                    response_data['setupRequired'] = False
                    
                self.send_json(response_data)
            else:
                self.send_json({'error': 'Phone number required'}, 400)
                
        elif self.path == '/api/auth/verify-code':
            phone = data.get('phone')
            code = data.get('code')
            
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('SELECT id, totp_secret FROM users WHERE phone = ?', (phone,))
            user = c.fetchone()
            
            if user and user[1] and verify_totp(user[1], code):
                session_token = str(uuid.uuid4())
                c.execute('UPDATE users SET session_token = ? WHERE phone = ?', (session_token, phone))
                conn.commit()
                conn.close()
                
                # Set cookie
                cookie = SimpleCookie()
                cookie['session_token'] = session_token
                cookie['session_token']['path'] = '/'
                cookie['session_token']['httponly'] = True
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Set-Cookie', cookie.output(header='', sep=''))
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode())
            else:
                conn.close()
                self.send_json({'error': 'Invalid code'}, 400)
                
        elif self.path == '/api/wallets':
            user = self.get_user_from_session()
            if not user:
                self.send_json({'error': 'Unauthorized'}, 401)
                return
                
            name = data.get('name', 'My Wallet')
            api_key = data.get('apiKey')
            secret_key = data.get('secretKey')
            
            if api_key and secret_key:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                # In a real app, encrypt the secret key!
                c.execute('INSERT INTO wallets (user_id, name, api_key, secret_key) VALUES (?, ?, ?, ?)', 
                          (user['id'], name, api_key, secret_key))
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

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('SELECT api_key, secret_key FROM wallets WHERE id = ? AND user_id = ?', (wallet_id, user['id']))
            wallet = c.fetchone()
            conn.close()

            if not wallet:
                self.send_json({'error': 'Wallet not found'}, 404)
                return

            public_key = wallet[0]
            private_key = wallet[1]

            # Prepare Tradernet payload

            payload = {
                "cmd": cmd,
                "params": params
            }
            payload_str = json.dumps(payload)
            timestamp = int(time.time())

            # HMAC-SHA256 Signature
            message = (payload_str + str(timestamp)).encode('utf-8')
            signature = hmac.new(
                private_key.encode('utf-8'),
                message,
                hashlib.sha256
            ).hexdigest()

            headers = {
                'X-NtApi-PublicKey': public_key,
                'X-NtApi-Sig': signature,
                'X-NtApi-Timestamp': str(timestamp),
                'Content-Type': 'application/json'
            }

            try:
                req = urllib.request.Request('https://tradernet.com/api/', data=payload_str.encode('utf-8'), headers=headers, method='POST')
                with urllib.request.urlopen(req) as response:
                    res_body = response.read()
                    self.send_json(json.loads(res_body.decode('utf-8')))
            except urllib.error.HTTPError as e:
                try:
                    error_res = json.loads(e.read().decode('utf-8'))
                    self.send_json(error_res, e.code)
                except:
                    self.send_json({'error': f'Tradernet API Error: {e.code}'}, e.code)
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
            
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('DELETE FROM wallets WHERE id = ? AND user_id = ?', (wallet_id, user['id']))
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

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def get_user_from_session(self):
        if 'Cookie' in self.headers:
            cookie = SimpleCookie(self.headers.get('Cookie'))
            if 'session_token' in cookie:
                token = cookie['session_token'].value
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT id, phone FROM users WHERE session_token = ?', (token,))
                user = c.fetchone()
                conn.close()
                if user:
                    return {'id': user[0], 'phone': user[1]}
        return None

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()
