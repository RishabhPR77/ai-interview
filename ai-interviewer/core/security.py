"""Hashing, token generation and at-rest encryption helpers."""
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken

from core.config import ENCRYPTION_KEY, SECRET_KEY

_fernet = Fernet(ENCRYPTION_KEY)


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(email: str, code: str) -> str:
    msg = f"{email.lower()}:{code}".encode()
    return hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def otp_matches(email: str, code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(email, code), code_hash)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def encrypt_secret(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken as e:
        raise ValueError("Stored key can't be decrypted — was ENCRYPTION_KEY changed?") from e


def key_hint(value: str) -> str:
    """Last 4 characters, enough for a user to recognise which key is saved."""
    value = value.strip()
    return f"…{value[-4:]}" if len(value) > 8 else "…"
