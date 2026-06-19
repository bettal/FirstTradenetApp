"""
Security utilities: HIBP password check, password strength validation.

HIBP (Have I Been Pwned) uses k-anonymity:
  - Computes SHA-1 of password
  - Sends first 5 hex chars to api.pwnedpasswords.com
  - Receives list of matching hash suffixes
  - Checks if our hash suffix is in the list (local, no password sent over network)
"""

import hashlib
import urllib.request
import logging

log = logging.getLogger(__name__)

HIBP_API = 'https://api.pwnedpasswords.com/range/'
HIBP_TIMEOUT = 5


def is_password_pwned(password: str) -> bool:
    """
    Check password against HIBP breach database using k-anonymity.
    Returns True if the password has appeared in known data breaches.
    """
    sha1_hash = hashlib.sha1(password.encode('utf-8')).hexdigest().upper()
    prefix = sha1_hash[:5]
    suffix = sha1_hash[5:]

    try:
        req = urllib.request.Request(
            HIBP_API + prefix,
            headers={'Add-Padding': 'true', 'User-Agent': 'Tradernet-Dashboard'}
        )
        with urllib.request.urlopen(req, timeout=HIBP_TIMEOUT) as resp:
            for line in resp.read().decode('utf-8').splitlines():
                line = line.strip()
                if ':' in line:
                    hash_suffix, count = line.split(':', 1)
                    if hash_suffix == suffix:
                        log.info(f"Password found in HIBP: {int(count)} breaches")
                        return True
    except Exception as e:
        log.warning(f"HIBP check failed (network/timout): {e}")
        # Fail open: don't reject password if HIBP is unreachable
        return False

    return False


def validate_password_strength(password: str) -> str | None:
    """
    Validate password strength. Returns error message or None if valid.

    Requirements:
      - Minimum 8 characters
      - At least one uppercase letter
      - At least one lowercase letter
      - At least one digit
    """
    if len(password) < 8:
        return 'Password must be at least 8 characters'
    if not any(c.isupper() for c in password):
        return 'Password must contain at least one uppercase letter'
    if not any(c.islower() for c in password):
        return 'Password must contain at least one lowercase letter'
    if not any(c.isdigit() for c in password):
        return 'Password must contain at least one digit'
    return None
