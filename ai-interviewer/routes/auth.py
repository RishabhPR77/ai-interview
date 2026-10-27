"""
Passwordless email sign-in.

POST /auth/request-otp  → emails a 6-digit code (same response whether or not the
                          account exists, so emails can't be enumerated)
POST /auth/verify-otp   → exchanges the code for an httpOnly session cookie;
                          first successful sign-in creates the account
POST /auth/logout       → revokes the current session
GET  /auth/me           → the signed-in user
"""
import logging
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Optional

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from core.config import (
    COOKIE_SAMESITE, COOKIE_SECURE, OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR,
    OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_MINUTES, SESSION_COOKIE_NAME, SESSION_TTL_DAYS,
    TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY,
)
from core.db import AuthSession, OtpCode, User, as_utc, get_db, utcnow
from core.deps import current_user
from core.email import EmailError, send_otp_email
from core.security import generate_otp, hash_otp, hash_token, new_session_token, otp_matches

router = APIRouter(prefix="/auth", tags=["Auth"])
log = logging.getLogger("tejaskrit.auth")

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

# Per-IP throttle on top of the per-email limits stored in the DB. In-memory is
# fine for a single instance; put a shared store (Redis) here if you scale out.
_IP_WINDOW_SECONDS = 3600
_IP_MAX_REQUESTS = 30
_ip_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Never read X-Forwarded-For here — clients can forge it. Behind a proxy,
    # uvicorn's --proxy-headers rewrites request.client from trusted proxies.
    return request.client.host if request.client else "unknown"


def _check_ip_rate(ip: str) -> None:
    now = time.monotonic()
    hits = _ip_hits[ip]
    while hits and now - hits[0] > _IP_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= _IP_MAX_REQUESTS:
        raise HTTPException(status_code=429, detail="Too many attempts from this network. Try again later.")
    hits.append(now)


class OtpRequest(BaseModel):
    email: EmailStr
    # Cloudflare Turnstile token; required when TURNSTILE_SECRET_KEY is set.
    turnstile_token: Optional[str] = Field(default=None, max_length=2048)


def _verify_turnstile(token: Optional[str], ip: str) -> None:
    """Stops scripts from using the sign-in form to send email (Brevo quota,
    sender reputation). No-op when Turnstile isn't configured."""
    if not TURNSTILE_SECRET_KEY:
        return
    if not token:
        raise HTTPException(status_code=400, detail={
            "code": "captcha_required", "message": "Please complete the verification check.",
        })
    try:
        resp = httpx.post(
            TURNSTILE_VERIFY_URL,
            data={"secret": TURNSTILE_SECRET_KEY, "response": token, "remoteip": ip},
            timeout=10,
        )
        result = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        log.error("Turnstile verification unavailable: %s", e)
        raise HTTPException(status_code=503, detail={
            "code": "captcha_unavailable", "message": "Couldn't run the verification check. Please try again.",
        })
    if not result.get("success"):
        log.info("Turnstile rejected token: %s", result.get("error-codes"))
        raise HTTPException(status_code=400, detail={
            "code": "captcha_failed", "message": "Verification failed or expired. Please try again.",
        })


class OtpVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "created_at": as_utc(user.created_at).isoformat(),
    }


@router.get("/config")
def auth_config():
    """Public settings the sign-in page needs."""
    return {"turnstile_site_key": TURNSTILE_SITE_KEY or None}


@router.post("/request-otp")
def request_otp(body: OtpRequest, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    _check_ip_rate(ip)
    _verify_turnstile(body.turnstile_token, ip)
    email = body.email.lower()
    now = utcnow()

    latest = db.execute(
        select(OtpCode).where(OtpCode.email == email).order_by(OtpCode.created_at.desc()).limit(1)
    ).scalar_one_or_none()
    if latest and (now - as_utc(latest.created_at)).total_seconds() < OTP_RESEND_COOLDOWN_SECONDS:
        wait = OTP_RESEND_COOLDOWN_SECONDS - int((now - as_utc(latest.created_at)).total_seconds())
        raise HTTPException(status_code=429, detail=f"Please wait {wait}s before requesting another code.")

    sent_last_hour = db.execute(
        select(func.count()).select_from(OtpCode)
        .where(OtpCode.email == email, OtpCode.created_at > now - timedelta(hours=1))
    ).scalar_one()
    if sent_last_hour >= OTP_MAX_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many codes requested. Try again in an hour.")

    code = generate_otp()
    # Only the newest code is valid — older unused codes are retired.
    db.execute(delete(OtpCode).where(OtpCode.email == email, OtpCode.consumed.is_(False)))
    db.add(OtpCode(
        email=email,
        code_hash=hash_otp(email, code),
        expires_at=now + timedelta(minutes=OTP_TTL_MINUTES),
    ))
    db.commit()

    try:
        send_otp_email(email, code)
    except EmailError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {"ok": True, "expires_in_seconds": OTP_TTL_MINUTES * 60,
            "resend_after_seconds": OTP_RESEND_COOLDOWN_SECONDS}


@router.post("/verify-otp")
def verify_otp(body: OtpVerify, request: Request, response: Response, db: Session = Depends(get_db)):
    _check_ip_rate(_client_ip(request))
    email = body.email.lower()
    now = utcnow()

    otp = db.execute(
        select(OtpCode)
        .where(OtpCode.email == email, OtpCode.consumed.is_(False))
        .order_by(OtpCode.created_at.desc()).limit(1)
    ).scalar_one_or_none()

    invalid = HTTPException(status_code=400, detail="That code is invalid or has expired. Request a new one.")
    if not otp or as_utc(otp.expires_at) < now or otp.attempts >= OTP_MAX_ATTEMPTS:
        raise invalid
    if not otp_matches(email, body.code, otp.code_hash):
        otp.attempts += 1
        db.commit()
        left = OTP_MAX_ATTEMPTS - otp.attempts
        if left <= 0:
            raise invalid
        raise HTTPException(status_code=400, detail=f"Incorrect code. {left} attempt{'s' if left != 1 else ''} left.")

    otp.consumed = True
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    is_new = user is None
    if is_new:
        user = User(email=email, name="")
        db.add(user)
        db.flush()
    user.last_login_at = now

    token = new_session_token()
    db.add(AuthSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=now + timedelta(days=SESSION_TTL_DAYS),
        user_agent=(request.headers.get("user-agent") or "")[:300],
    ))
    # Housekeeping: drop this user's expired sessions and old consumed codes.
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < now))
    db.execute(delete(OtpCode).where(OtpCode.email == email, OtpCode.consumed.is_(True)))
    db.commit()

    response.set_cookie(
        SESSION_COOKIE_NAME, token,
        max_age=SESSION_TTL_DAYS * 86400,
        httponly=True,
        secure=COOKIE_SECURE or COOKIE_SAMESITE == "none",
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    return {"user": user_payload(user), "is_new": is_new}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/",
                           secure=COOKIE_SECURE or COOKIE_SAMESITE == "none", samesite=COOKIE_SAMESITE)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"user": user_payload(user)}


@router.patch("/me")
def update_me(body: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.name = body.name.strip()
    db.commit()
    return {"user": user_payload(user)}
