"""
Crypto module: key management, versioning, and rotation.

Provides:
  - encrypt_server / decrypt_server    (TOTP secrets — versioned Fernet)
  - phone_hash / phone_hash_verify     (phone lookup — separate HMAC key)
  - rotate_keys                        (migrate old-version data to new key)

Key separation:
  SERVER_ENCRYPTION_KEY  — Fernet key for TOTP secrets (via KMS)
  PHONE_HMAC_KEY         — HMAC-SHA256 key for phone hashing (via KMS)
  KEY_VERSION            — integer, incremented on rotation (default 0)
  SERVER_ENCRYPTION_KEY_V{n} — old keys for decryption during rotation

Backward compatibility:
  If PHONE_HMAC_KEY is not set, derived from SERVER_ENCRYPTION_KEY via HKDF.
"""

import os
import hmac
import hashlib
import base64
import logging
from cryptography.fernet import Fernet

log = logging.getLogger(__name__)

# ── Try KMS, fall back to os.environ ───────────────────────────────

def _env_or_kms(key: str, default: str | None = None) -> str | None:
    """Get secret from KMS or os.environ."""
    try:
        from kms import kms_get
        val = kms_get(key)
        if val is not None:
            return val
    except ImportError:
        pass
    return os.environ.get(key, default)

def _env_or_kms_generate(key: str) -> str:
    """Get secret from KMS or generate + store."""
    try:
        from kms import kms_get_or_generate
        return kms_get_or_generate(key)
    except ImportError:
        val = os.environ.get(key)
        if val:
            return val
        val = base64.urlsafe_b64encode(os.urandom(32)).decode('utf-8')
        os.environ[key] = val
        log.warning(f"Generated {key} — save to .env for persistence!")
        return val

# ── HKDF key derivation ───────────────────────────────────────────

_HKDF_INFO_HMAC = b'phone-hmac-key-v1'

def _derive_hmac_key(master_key: str) -> str:
    """Derive HMAC key from master encryption key using HKDF-SHA256."""
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_HKDF_INFO_HMAC,
    )
    derived = hkdf.derive(master_key.encode('utf-8'))
    return base64.urlsafe_b64encode(derived).decode('utf-8')

# ── Key initialization ────────────────────────────────────────────

_enc_key_raw = _env_or_kms_generate('SERVER_ENCRYPTION_KEY')
# Derive proper 32-byte Fernet key from the raw key
_enc_key_bytes = base64.urlsafe_b64encode(
    hashlib.sha256(_enc_key_raw.encode()).digest()
)
_fernet = Fernet(_enc_key_bytes)

# Old key for rotation (key version 0 = no prefix, current = v1)
_old_key_raw = _env_or_kms('SERVER_ENCRYPTION_KEY_V0')
_old_fernet = None
if _old_key_raw:
    _old_key_bytes = base64.urlsafe_b64encode(
        hashlib.sha256(_old_key_raw.encode()).digest()
    )
    _old_fernet = Fernet(_old_key_bytes)

CURRENT_VERSION = int(_env_or_kms('KEY_VERSION', '1') or '1')
_VERSION_PREFIX = f'v{CURRENT_VERSION}:'

# Phone HMAC key — separate from encryption key
_phone_hmac_raw = _env_or_kms('PHONE_HMAC_KEY')
if _phone_hmac_raw:
    _phone_hmac_key = _phone_hmac_raw.encode('utf-8')
else:
    # Backward compat: derive from encryption key
    _phone_hmac_key = _derive_hmac_key(_enc_key_raw).encode('utf-8')
    log.info("PHONE_HMAC_KEY not set — derived from SERVER_ENCRYPTION_KEY via HKDF")

# ── Public API ─────────────────────────────────────────────────────

def encrypt_server(value: str) -> str:
    """Encrypt a value with the current server key (versioned)."""
    encrypted = _fernet.encrypt(value.encode('utf-8')).decode('utf-8')
    return _VERSION_PREFIX + encrypted

def decrypt_server(value: str | None) -> str | None:
    """Decrypt a value, handling multiple key versions."""
    if not value:
        return None
    # Check for version prefix: 'vN:' or old unversioned Fernet format
    if value.startswith('v') and ':' in value[:4]:
        ver_end = value.index(':')
        try:
            version = int(value[1:ver_end])
        except ValueError:
            log.warning(f"decrypt_server: invalid version prefix in value")
            return None
        ciphertext = value[ver_end + 1:]
        if version == CURRENT_VERSION:
            try:
                return _fernet.decrypt(ciphertext.encode('utf-8')).decode('utf-8')
            except Exception:
                log.warning(f"decrypt_server: failed to decrypt with current key v{version}")
                return None
        # Try old keys
        if _old_fernet:
            try:
                return _old_fernet.decrypt(ciphertext.encode('utf-8')).decode('utf-8')
            except Exception:
                pass
        log.warning(f"decrypt_server: unknown key version {version}")
        return None

    # Old unversioned format (backward compat: try current, then old)
    try:
        return _fernet.decrypt(value.encode('utf-8')).decode('utf-8')
    except Exception:
        if _old_fernet:
            try:
                return _old_fernet.decrypt(value.encode('utf-8')).decode('utf-8')
            except Exception:
                pass
    return None

def phone_hash(phone: str) -> str:
    """Compute HMAC-SHA256 hash of phone for DB lookup."""
    return hmac.new(_phone_hmac_key, phone.encode('utf-8'), hashlib.sha256).hexdigest()

def phone_hash_verify(phone: str, expected_hash: str) -> bool:
    """Verify phone against stored hash (constant-time)."""
    return hmac.compare_digest(phone_hash(phone), expected_hash)

def rotate_keys(db_conn, new_key_raw: str) -> int:
    """
    Rotate encryption keys: re-encrypt all TOTP secrets with new key.
    Call AFTER updating SERVER_ENCRYPTION_KEY env var and incrementing KEY_VERSION.
    Returns number of records re-encrypted.
    """
    new_key_bytes = base64.urlsafe_b64encode(
        hashlib.sha256(new_key_raw.encode()).digest()
    )
    new_fernet = Fernet(new_key_bytes)
    cursor = db_conn.cursor()
    cursor.execute("SELECT id, totp_secret_encrypted FROM users WHERE totp_secret_encrypted IS NOT NULL AND totp_secret_encrypted != ''")
    count = 0
    for uid, encrypted in cursor.fetchall():
        decrypted = decrypt_server(encrypted)
        if decrypted:
            new_encrypted = f'v{CURRENT_VERSION + 1}:' + new_fernet.encrypt(
                decrypted.encode('utf-8')
            ).decode('utf-8')
            cursor.execute(
                "UPDATE users SET totp_secret_encrypted = %s WHERE id = %s",
                (new_encrypted, uid)
            )
            count += 1
    db_conn.commit()
    log.info(f"rotate_keys: re-encrypted {count} TOTP secrets")
    return count
