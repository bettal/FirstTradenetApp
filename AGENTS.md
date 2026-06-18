# AGENTS.md

## Quick start
- `./start.sh` -- creates `.venv`, installs deps, starts server on `localhost:8000`
- `./stop.sh` -- kills the server
- `pip install -r requirements.txt` for standalone dep install

## Architecture
- `backend.py` is the single-entry HTTP server (stdlib `http.server`, port 8000). Serves `static/` files and REST API routes.
- Two independent `TradeManager` classes exist: one in `trade_manager.py` (standalone), one in `backend.py:126` (server-side, used when `tradernet-sdk` / `tradernet-api` packages are installed).
- Hybrid pattern: official SDK (`tradernet-sdk`) for market data, third-party API (`tradernet-api`) for order execution / stop-loss. Both are optional -- server degrades gracefully when missing.

## Database
- PostgreSQL, configured via env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (defaults: localhost, 5432, tradernet, postgres, postgres).
- Tables created automatically on startup (`users`, `wallets`, `api_dictionaries`, `api_dictionary_entries`).
- Wallet secret keys are encrypted with Fernet using a PBKDF2-derived key from the user's password + salt.

## Frontend
- Plain HTML/CSS/JS in `static/`. No framework. Uses `qrcodejs` CDN for 2FA setup.
- Pages: `/` (login), `/dashboard` (wallets + API explorer), `/dictionaries` (reference data browser).
- API endpoints at `/api/*` -- see `COMMANDS_REGISTRY` in `backend.py` (organized into 10 categories from the Tradernet API docs: user_data, security_session, securities_lists, quotes_tickers, portfolio, orders, price_alerts, requests, broker_report, currencies, various, websocket, advanced).

## API Dictionaries
- 8 reference dictionaries from the Tradernet API "Various" section are defined in the DB.
- Navigate to `/dictionaries` to browse, expand entries, and refresh them from the live API.
- Refresh requires a selected wallet; entries are fetched via `/api/dictionaries/<code>/refresh` (POST) and cached in `api_dictionary_entries`.

## What's missing
- **No tests** at all. No test framework, no test directory.
- **No linter, no typechecker, no formatter** config.
- **No CI/CD** config.
- Config template in `config.py` expects `public_key` / `private_key` but is only for standalone mode; the web app stores per-wallet keys in the DB.
