"""
KMS (Key Management Service) abstraction layer.

Supports three backends:
  - env:       Secrets from environment variables (default, zero-dependency)
  - vault:     HashiCorp Vault (requires hvac package)
  - aws:       AWS Secrets Manager (requires boto3 package)

Configuration via environment variables:
  KMS_PROVIDER          = env | vault | aws     (default: env)
  VAULT_ADDR            = https://vault:8200     (default if provider=vault)
  VAULT_TOKEN           = vault root or app token
  VAULT_MOUNT           = secret                (KVv2 mount point, default: secret)
  VAULT_PATH            = tradernet              (KVv2 path prefix, default: tradernet)
  AWS_REGION            = us-east-1              (default if provider=aws)
  AWS_SECRET_NAME       = tradernet/production   (Secrets Manager secret name)
  AWS_ACCESS_KEY_ID     = ...                    (optional, also supports IAM roles)
  AWS_SECRET_ACCESS_KEY = ...
"""

import os
import json
import logging
from abc import ABC, abstractmethod

log = logging.getLogger(__name__)

# Secrets that KMS can provide
SECRET_KEYS = [
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'SERVER_ENCRYPTION_KEY', 'PHONE_HMAC_KEY',
    'SERVER_ENCRYPTION_KEY_V0',  # old key for rotation
]

# Non-secret config keys (fallback to env or defaults)
CONFIG_DEFAULTS = {
    'DB_HOST': 'localhost',
    'DB_PORT': '5432',
    'DB_NAME': 'tradernet',
    'DB_USER': 'postgres',
    'DB_PASSWORD': 'postgres',
}

# ── Provider abstraction ───────────────────────────────────────────

class KMSProvider(ABC):
    """Abstract Key Management Service provider."""

    @abstractmethod
    def get_secret(self, key: str) -> str | None:
        """Retrieve a secret by key. Returns None if not found."""
        ...

    @abstractmethod
    def get_secrets(self) -> dict:
        """Retrieve all application secrets as a dict."""
        ...

    def set_secret(self, key: str, value: str):
        """Store a secret. Not supported by all providers."""
        raise NotImplementedError(
            f"set_secret not implemented for {self.__class__.__name__}"
        )

# ── Environment provider (default, zero-dependency) ────────────────

class EnvKMS(KMSProvider):
    """Read secrets from environment variables."""

    def __init__(self):
        self._cache = {}

    def get_secret(self, key: str) -> str | None:
        if key in self._cache:
            return self._cache[key]
        val = os.environ.get(key)
        if val is not None:
            self._cache[key] = val
        return val

    def get_secrets(self) -> dict:
        secrets = {}
        for key in SECRET_KEYS:
            val = self.get_secret(key)
            if val is not None:
                secrets[key] = val
        return secrets

    def set_secret(self, key: str, value: str):
        os.environ[key] = value
        self._cache[key] = value

# ── HashiCorp Vault provider ───────────────────────────────────────

class VaultKMS(KMSProvider):
    """Retrieve secrets from HashiCorp Vault KVv2."""

    def __init__(self, addr=None, token=None, mount='secret', path='tradernet'):
        self._addr = addr or os.environ.get('VAULT_ADDR', 'https://vault:8200')
        self._token = token or os.environ.get('VAULT_TOKEN', '')
        self._mount = mount or os.environ.get('VAULT_MOUNT', 'secret')
        self._path = path or os.environ.get('VAULT_PATH', 'tradernet')
        self._cache = {}

    @property
    def _client(self):
        if not hasattr(self, '_vault_client'):
            try:
                import hvac
            except ImportError:
                raise RuntimeError(
                    "hvac package required for Vault KMS. Install: pip install hvac"
                )
            self._vault_client = hvac.Client(url=self._addr, token=self._token)
            if not self._vault_client.is_authenticated():
                raise RuntimeError(f"Vault authentication failed at {self._addr}")
        return self._vault_client

    def get_secret(self, key: str) -> str | None:
        if key in self._cache:
            return self._cache[key]
        try:
            full_path = f'{self._mount}/data/{self._path}'
            response = self._client.secrets.kv.v2.read_secret_version(
                path=self._path, mount_point=self._mount
            )
            data = response.get('data', {}).get('data', {})
            if key in data:
                self._cache[key] = str(data[key])
                return self._cache[key]
        except Exception as e:
            log.error(f"Vault: failed to read secret {key}: {e}")
        return None

    def get_secrets(self) -> dict:
        secrets = {}
        try:
            response = self._client.secrets.kv.v2.read_secret_version(
                path=self._path, mount_point=self._mount
            )
            data = response.get('data', {}).get('data', {})
            for key in SECRET_KEYS:
                if key in data:
                    secrets[key] = str(data[key])
                    self._cache[key] = str(data[key])
        except Exception as e:
            log.error(f"Vault: failed to read secrets batch: {e}")
        return secrets

    def set_secret(self, key: str, value: str):
        self._client.secrets.kv.v2.create_or_update_secret(
            path=self._path,
            data={key: value},
            mount_point=self._mount,
        )
        self._cache[key] = value

# ── AWS Secrets Manager provider ───────────────────────────────────

class AWSSecretsManagerKMS(KMSProvider):
    """Retrieve secrets from AWS Secrets Manager."""

    def __init__(self, region=None, secret_name=None):
        self._region = region or os.environ.get('AWS_REGION', 'us-east-1')
        self._secret_name = secret_name or os.environ.get('AWS_SECRET_NAME', 'tradernet/production')
        self._cache = {}

    @property
    def _client(self):
        if not hasattr(self, '_sm_client'):
            try:
                import boto3
            except ImportError:
                raise RuntimeError(
                    "boto3 package required for AWS KMS. Install: pip install boto3"
                )
            self._sm_client = boto3.client(
                'secretsmanager',
                region_name=self._region,
            )
        return self._sm_client

    def _fetch(self):
        """Fetch and parse the JSON secret from AWS."""
        try:
            response = self._client.get_secret_value(SecretId=self._secret_name)
            if 'SecretString' in response:
                data = json.loads(response['SecretString'])
                for key in SECRET_KEYS:
                    if key in data:
                        self._cache[key] = str(data[key])
            elif 'SecretBinary' in response:
                import base64
                data = json.loads(base64.b64decode(response['SecretBinary']))
                for key in SECRET_KEYS:
                    if key in data:
                        self._cache[key] = str(data[key])
        except Exception as e:
            log.error(f"AWS Secrets Manager: failed to fetch {self._secret_name}: {e}")

    def get_secret(self, key: str) -> str | None:
        if key in self._cache:
            return self._cache[key]
        self._fetch()
        return self._cache.get(key)

    def get_secrets(self) -> dict:
        if not self._cache:
            self._fetch()
        return dict(self._cache)

    def set_secret(self, key: str, value: str):
        import json as _json
        self._fetch()
        self._cache[key] = value
        self._client.put_secret_value(
            SecretId=self._secret_name,
            SecretString=_json.dumps(self._cache),
        )

# ── Factory: choose provider ───────────────────────────────────────

_provider: KMSProvider | None = None

def get_kms() -> KMSProvider:
    """Return the configured KMS provider (singleton)."""
    global _provider
    if _provider is not None:
        return _provider

    provider_name = os.environ.get('KMS_PROVIDER', 'env').lower()

    if provider_name == 'vault':
        log.info("KMS: using HashiCorp Vault")
        _provider = VaultKMS()
    elif provider_name == 'aws':
        log.info("KMS: using AWS Secrets Manager")
        _provider = AWSSecretsManagerKMS()
    else:
        log.info("KMS: using environment variables (env)")
        _provider = EnvKMS()

    return _provider

def kms_get(key: str, default: str | None = None) -> str | None:
    """Convenience: get a single secret."""
    val = get_kms().get_secret(key)
    if val is not None:
        return val
    if default is not None:
        return default
    return CONFIG_DEFAULTS.get(key)

def kms_get_or_generate(key: str) -> str:
    """Get a secret, generating and persisting if missing."""
    val = get_kms().get_secret(key)
    if val:
        return val
    # Generate a new random key and attempt to store it
    import base64 as _b64
    new_val = _b64.urlsafe_b64encode(os.urandom(32)).decode('utf-8')
    os.environ[key] = new_val
    # Persist to KMS backend if supported
    try:
        get_kms().set_secret(key, new_val)
    except Exception as e:
        log.warning(f"KMS: failed to persist generated key {key}: {e}")
    log.warning(
        f"KMS: {key} not found in {os.environ.get('KMS_PROVIDER', 'env')}, "
        f"generated new value — save this for persistence!"
    )
    return new_val
