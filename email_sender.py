"""
Email sender: SMTP with dev-mode fallback (logs verification links).

Configuration (environment variables):
  SMTP_HOST     — SMTP server hostname (if not set, dev-mode: log to console)
  SMTP_PORT     — SMTP port (default: 587)
  SMTP_USER     — SMTP username (default: empty)
  SMTP_PASSWORD — SMTP password (default: empty)
  SMTP_FROM     — From address (default: noreply@localhost)
  SMTP_USE_TLS  — Use STARTTLS (default: true)
"""

import os
import smtplib
import logging
import secrets
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

log = logging.getLogger(__name__)


def _smtp_host():
    return os.environ.get('SMTP_HOST', '')


def _is_dev_mode():
    return not _smtp_host()


def _smtp_config():
    return {
        'host': _smtp_host(),
        'port': int(os.environ.get('SMTP_PORT', '587')),
        'user': os.environ.get('SMTP_USER', ''),
        'password': os.environ.get('SMTP_PASSWORD', ''),
        'from': os.environ.get('SMTP_FROM', 'noreply@localhost'),
        'use_tls': os.environ.get('SMTP_USE_TLS', 'true').lower() != 'false',
    }


if _is_dev_mode():
    log.info("Email: SMTP not configured — verification links will be logged to console")
else:
    log.info(f"Email: SMTP configured, host={_smtp_host()}")


def send_verification_email(to_email: str, token: str, host_url: str) -> bool:
    """Send email verification link. In dev mode, prints link to log."""
    verify_url = f"{host_url}/verify-email?token={token}"

    if _is_dev_mode():
        log.info("=" * 60)
        log.info(f"DEV MODE — Verification link for {to_email}:")
        log.info(f"  {verify_url}")
        log.info("=" * 60)
        return True

    subject = "Verify your Tradernet Dashboard email"
    body = f"""Hello,

Please verify your email address for Tradernet Dashboard by clicking the link below:

{verify_url}

This link is valid for 24 hours.

If you did not create this account, please ignore this email.

— Tradernet Dashboard
"""

    return _send_email(to_email, subject, body)


def send_password_reset(to_email: str, new_password: str) -> bool:
    """Send a newly generated password to the user's email."""
    if _is_dev_mode():
        log.info("=" * 60)
        log.info(f"DEV MODE — Password reset for {to_email}:")
        log.info(f"  New password: {new_password}")
        log.info("=" * 60)
        return True

    subject = "Tradernet Dashboard — Password Reset"
    body = f"""Hello,

Your password for Tradernet Dashboard has been reset. Here is your new password:

{new_password}

Please log in and change your password immediately on the Profile page.

If you did not request this reset, please contact support immediately.

— Tradernet Dashboard
"""

    return _send_email(to_email, subject, body)


def generate_token() -> str:
    """Generate a random URL-safe token."""
    return secrets.token_urlsafe(32)


def _send_email(to: str, subject: str, body: str) -> bool:
    """Send an email via SMTP. Returns True on success."""
    cfg = _smtp_config()
    try:
        msg = MIMEMultipart()
        msg['From'] = cfg['from']
        msg['To'] = to
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain', 'utf-8'))

        if cfg['use_tls']:
            smtp = smtplib.SMTP(cfg['host'], cfg['port'], timeout=10)
            smtp.starttls()
        else:
            smtp = smtplib.SMTP_SSL(cfg['host'], cfg['port'], timeout=10)

        if cfg['user'] and cfg['password']:
            smtp.login(cfg['user'], cfg['password'])

        smtp.send_message(msg)
        smtp.quit()
        log.info(f"Email sent to {to}: {subject}")
        return True
    except Exception as e:
        log.error(f"Failed to send email to {to}: {e}")
        return False
