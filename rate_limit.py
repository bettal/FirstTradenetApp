"""
Application-level rate limiter — thread-safe sliding window.

Provides defense-in-depth alongside nginx-level rate limiting.
Protects against direct backend access and nginx bypass.

Two tiers:
  general: 10 requests/second per IP (burst 20)
  auth:    5 requests/minute per IP  (burst 3) — for /api/auth/*

Usage:
    from rate_limit import check_rate_limit

    allowed, retry_after = check_rate_limit(ip, is_auth=False)
    if not allowed:
        send 429 with Retry-After header
"""

import time
import threading
from collections import deque
from typing import Tuple

# ── Configuration ───────────────────────────────────────────────────

# General API: 10 req/s, burst 20 (matching nginx config)
_GENERAL_RATE = 10       # requests
_GENERAL_WINDOW = 1.0     # seconds
_GENERAL_BURST = 20

# Auth endpoints: 5 req/min, burst 3 (matching nginx config)
_AUTH_RATE = 5            # requests
_AUTH_WINDOW = 60.0        # seconds
_AUTH_BURST = 3

# Cleanup: remove IPs with no requests in this many seconds
_CLEANUP_AGE = 300  # 5 minutes

# ── State ───────────────────────────────────────────────────────────

_lock = threading.Lock()
# {ip: deque([timestamp, ...])}
_general_ips: dict[str, deque] = {}
_auth_ips: dict[str, deque] = {}
_last_cleanup = time.time()

# ── Internal ────────────────────────────────────────────────────────

def _prune(dq: deque, window: float, now: float):
    """Remove timestamps outside the current window."""
    cutoff = now - window
    while dq and dq[0] < cutoff:
        dq.popleft()

def _cleanup_stale(now: float):
    """Remove IPs with no recent requests."""
    global _last_cleanup
    if now - _last_cleanup < _CLEANUP_AGE:
        return
    _last_cleanup = now
    cutoff = now - _CLEANUP_AGE
    for store in (_general_ips, _auth_ips):
        stale = [ip for ip, dq in store.items() if not dq or dq[-1] < cutoff]
        for ip in stale:
            del store[ip]

def _check(store: dict, ip: str, rate: int, window: float, burst: int, now: float) -> Tuple[bool, float]:
    """Check rate limit for an IP. Returns (allowed, retry_after_seconds)."""
    with _lock:
        dq = store.get(ip)
        if dq is None:
            dq = deque()
            store[ip] = dq

        _prune(dq, window, now)

        if len(dq) >= burst:
            # Burst exceeded — check if also over the rate
            # The oldest request still in window tells us when we can retry
            retry_after = (dq[0] + window) - now
            if retry_after > 0:
                return False, retry_after

        dq.append(now)
        _cleanup_stale(now)
        return True, 0.0

# ── Public API ──────────────────────────────────────────────────────

def get_client_ip(request_headers: dict, client_address: tuple = None) -> str:
    """Extract client IP from headers (X-Forwarded-For) or socket address."""
    # X-Forwarded-For: client, proxy1, proxy2
    forwarded = request_headers.get('X-Forwarded-For', '')
    if forwarded:
        ip = forwarded.split(',')[0].strip()
        if ip:
            return ip
    # X-Real-IP (set by nginx)
    real_ip = request_headers.get('X-Real-IP', '')
    if real_ip:
        return real_ip.strip()
    # Fallback to direct connection
    if client_address:
        return client_address[0]
    return '127.0.0.1'

def check_rate_limit(ip: str, is_auth: bool = False) -> Tuple[bool, float, int, int]:
    """
    Check rate limit for an IP address.
    
    Returns:
        (allowed, retry_after_seconds, remaining, limit)
    """
    now = time.time()
    if is_auth:
        allowed, retry = _check(_auth_ips, ip, _AUTH_RATE, _AUTH_WINDOW, _AUTH_BURST, now)
        with _lock:
            dq = _auth_ips.get(ip, deque())
            _prune(dq, _AUTH_WINDOW, now)
            remaining = max(0, _AUTH_BURST - len(dq))
        return allowed, retry, remaining, _AUTH_BURST
    else:
        allowed, retry = _check(_general_ips, ip, _GENERAL_RATE, _GENERAL_WINDOW, _GENERAL_BURST, now)
        with _lock:
            dq = _general_ips.get(ip, deque())
            _prune(dq, _GENERAL_WINDOW, now)
            remaining = max(0, _GENERAL_BURST - len(dq))
        return allowed, retry, remaining, _GENERAL_BURST

def reset_ip(ip: str):
    """Reset rate limit counters for an IP (e.g., after successful login)."""
    with _lock:
        _general_ips.pop(ip, None)
        _auth_ips.pop(ip, None)

def get_stats() -> dict:
    """Return current rate limiter statistics (for debugging)."""
    with _lock:
        return {
            'general_ips': len(_general_ips),
            'auth_ips': len(_auth_ips),
        }
