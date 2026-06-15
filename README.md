# Tradernet Hybrid Trading System

This project implements a hybrid trading system that combines the strengths of both the official Tradernet SDK and a third-party API client to provide comprehensive trading capabilities.

## Overview

The hybrid system leverages two different API approaches:

- **Official SDK** (`tradernet-sdk`): Used for market data, quotes, WebSocket connections, and portfolio management
- **Third-party Client** (`tradernet-api`): Used for order execution, stop-loss and take-profit orders

## Architecture

### Component Map

| System Component | Official SDK (`tradernet-sdk`) | Third-party Client (`tradernet-api`) |
| :--- | :--- | :--- |
| **Initialization** | Primary connection for authorization and data retrieval | Secondary connection using the same API keys |
| **Market Data & Analytics** |  **Market Data**: Retrieving quotes, order books, historical candles (HLOC)<br> **WebSocket**: Real-time data streaming<br> **Options Work**: Parsing and analysis of options contracts<br> **Fundamental Data**: News and ticker information | Not used |
| **Portfolio Management** |  **Portfolio & Positions**: Portfolio information and subscription to changes<br> **Security Sessions**: Management and configuration | Not used |
| **Order Execution** | No explicit stop-order methods. Market and limit orders sent directly |  **Stop-Loss & Take-Profit**: `set_stop_order()` - key function missing from official SDK<br> **Basic Orders**: Send, cancel, and view orders |

## Installation

Install the required dependencies:

```bash
pip install -r requirements.txt
```

## Configuration

Create a `config.py` file with your API credentials:

```python
# config.py
TRADERNET_CONFIG = {
    "public_key": "YOUR_PUBLIC_KEY",
    "private_key": "YOUR_PRIVATE_KEY",
}
```

## Usage

The main `TradeManager` class provides a unified interface:

```python
# main.py
import asyncio
from trade_manager import TradeManager

trader = TradeManager()

# --- Retrieving market data (using official SDK) ---
print(trader.get_quotes("AAPL.US"))

# --- Trading and risk management (using third-party API) ---
# Sending a market order
order_id = trader.send_order("AAPL.US", "buy", 10, market_order=True)

# Setting protective orders
trader.set_stop_loss_take_profit("AAPL.US", stop_loss=150, take_profit=180)
```

## Components

- `trade_manager.py`: Main class that encapsulates both API clients
- `config.py`: Centralized API key configuration
- `main.py`: Example usage of the hybrid system

## Benefits

This hybrid approach allows you to:
- Access comprehensive market data through the official SDK
- Execute stop-loss and take-profit orders which may not be available in the official SDK
- Maintain a clean, unified interface for both APIs
- Easily switch between or extend functionality as needed