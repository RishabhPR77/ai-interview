"""
Account: provider API keys (bring your own key), model choices, account deletion.

Keys are validated against the provider before being stored, encrypted with
ENCRYPTION_KEY, and never returned to the browser — only a short hint.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete
from sqlalchemy.orm import Session

from core.ai_settings import get_keys, get_settings_row
from core.config import COOKIE_SAMESITE, COOKIE_SECURE, SESSION_COOKIE_NAME
from core.db import AuthSession, InterviewSession, ProviderKey, User, UserSettings, as_utc, get_db, utcnow
from core.deps import current_user
from core.llm import PROVIDERS, STT_PROVIDERS, AIError, list_models, validate_key
from core.security import decrypt_secret, encrypt_secret, key_hint

router = APIRouter(prefix="/account", tags=["Account"])

ProviderId = Literal["anthropic", "openai", "groq", "gemini", "openrouter"]


class KeyIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=500)


class SettingsIn(BaseModel):
    eval_provider: Optional[ProviderId] = None
    eval_model: Optional[str] = Field(default=None, max_length=200)
    fast_provider: Optional[ProviderId] = None
    fast_model: Optional[str] = Field(default=None, max_length=200)
    stt_provider: Optional[ProviderId] = None
    stt_model: Optional[str] = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _check(self) -> "SettingsIn":
        if self.stt_provider and self.stt_provider not in STT_PROVIDERS:
            raise ValueError(f"{PROVIDERS[self.stt_provider]['label']} doesn't offer speech-to-text")
        for p, m in ((self.eval_provider, self.eval_model), (self.fast_provider, self.fast_model),
                     (self.stt_provider, self.stt_model)):
            if bool(p) != bool(m and m.strip()):
                raise ValueError("Each choice needs both a provider and a model")
        return self


def _settings_payload(db: Session, user: User) -> dict:
    s = get_settings_row(db, user.id)
    keys = get_keys(db, user.id)
    providers = []
    for pid, cfg in PROVIDERS.items():
        k = keys.get(pid)
        providers.append({
            "id": pid,
            "label": cfg["label"],
            "key_url": cfg["key_url"],
            "supports_stt": pid in STT_PROVIDERS,
            "suggested_llm": cfg["llm"],
            "suggested_fast": cfg["fast_default"],
            "suggested_stt": cfg["stt"],
            "connected": k is not None,
            "key_hint": k.key_hint if k else None,
            "updated_at": as_utc(k.updated_at).isoformat() if k else None,
        })
    selection = {
        "eval_provider": s.eval_provider, "eval_model": s.eval_model,
        "fast_provider": s.fast_provider, "fast_model": s.fast_model,
        "stt_provider": s.stt_provider, "stt_model": s.stt_model,
    }
    ready = bool(
        s.eval_provider in keys and s.eval_model
        and s.stt_provider in keys and s.stt_model
        and (not s.fast_provider or s.fast_provider in keys)
    )
    return {"providers": providers, "selection": selection, "ready": ready}


@router.get("/ai")
def get_ai_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    payload = _settings_payload(db, user)
    db.commit()
    return payload


@router.put("/ai")
def put_ai_settings(body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = get_settings_row(db, user.id)
    for field, value in body.model_dump().items():
        setattr(s, field, value.strip() if isinstance(value, str) else value)
    s.updated_at = utcnow()
    db.commit()
    return _settings_payload(db, user)


@router.put("/keys/{provider}")
def put_key(provider: ProviderId, body: KeyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    api_key = body.api_key.strip()
    try:
        validate_key(provider, api_key)
    except AIError as e:
        raise HTTPException(status_code=400, detail=e.message.replace(
            "Update it in Settings.", "Check the key and try again."))

    keys = get_keys(db, user.id)
    row = keys.get(provider) or ProviderKey(user_id=user.id, provider=provider)
    row.encrypted_key = encrypt_secret(api_key)
    row.key_hint = key_hint(api_key)
    row.updated_at = utcnow()
    db.add(row)

    # First key added → preselect sensible defaults so the user can start immediately.
    s = get_settings_row(db, user.id)
    cfg = PROVIDERS[provider]
    if not s.eval_provider:
        s.eval_provider, s.eval_model = provider, cfg["llm"][0]
    if not s.stt_provider and provider in STT_PROVIDERS and cfg["stt"]:
        s.stt_provider, s.stt_model = provider, cfg["stt"][0]
    db.commit()
    return _settings_payload(db, user)


@router.delete("/keys/{provider}")
def delete_key(provider: ProviderId, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(ProviderKey).where(ProviderKey.user_id == user.id, ProviderKey.provider == provider))
    s = get_settings_row(db, user.id)
    for prefix in ("eval", "fast", "stt"):
        if getattr(s, f"{prefix}_provider") == provider:
            setattr(s, f"{prefix}_provider", None)
            setattr(s, f"{prefix}_model", None)
    db.commit()
    return _settings_payload(db, user)


@router.get("/models/{provider}")
def get_models(provider: ProviderId, user: User = Depends(current_user), db: Session = Depends(get_db)):
    k = get_keys(db, user.id).get(provider)
    if not k:
        raise HTTPException(status_code=404, detail="Add a key for this provider first")
    try:
        models = list_models(provider, decrypt_secret(k.encrypted_key))
    except (AIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=getattr(e, "message", str(e)))
    return {"provider": provider, **models}


@router.delete("")
def delete_account(response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Permanently delete the account, its keys, settings and any in-progress interviews."""
    db.execute(delete(InterviewSession).where(InterviewSession.user_id == user.id))
    db.execute(delete(ProviderKey).where(ProviderKey.user_id == user.id))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.delete(user)
    db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/",
                           secure=COOKIE_SECURE or COOKIE_SAMESITE == "none", samesite=COOKIE_SAMESITE)
    return {"ok": True}
