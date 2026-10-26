"""Load a user's provider keys + model choices and turn them into an AIConfig."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import ProviderKey, UserSettings
from core.llm import PROVIDERS, AIConfig, Target
from core.security import decrypt_secret


def get_settings_row(db: Session, user_id: str) -> UserSettings:
    row = db.get(UserSettings, user_id)
    if row is None:
        row = UserSettings(user_id=user_id)
        db.add(row)
        db.flush()
    return row


def get_keys(db: Session, user_id: str) -> dict[str, ProviderKey]:
    rows = db.execute(select(ProviderKey).where(ProviderKey.user_id == user_id)).scalars()
    return {r.provider: r for r in rows}


def _target(keys: dict[str, ProviderKey], provider: str | None, model: str | None, what: str) -> Target:
    if not provider or not model:
        raise HTTPException(status_code=409, detail={
            "code": "ai_not_configured",
            "message": f"Choose the {what} model in Settings before starting an interview.",
        })
    if provider not in keys:
        raise HTTPException(status_code=409, detail={
            "code": "ai_not_configured",
            "message": f"Add your {PROVIDERS[provider]['label']} API key in Settings — it's used for the {what} model.",
        })
    try:
        api_key = decrypt_secret(keys[provider].encrypted_key)
    except ValueError:
        raise HTTPException(status_code=409, detail={
            "code": "ai_not_configured",
            "message": f"Your saved {PROVIDERS[provider]['label']} key can't be read. Please re-enter it in Settings.",
        })
    return Target(provider, model, api_key)


def load_ai_config(db: Session, user_id: str, need_stt: bool = True) -> AIConfig:
    settings = get_settings_row(db, user_id)
    keys = get_keys(db, user_id)
    eval_t = _target(keys, settings.eval_provider, settings.eval_model, "evaluation")
    if settings.fast_provider and settings.fast_model:
        fast_t = _target(keys, settings.fast_provider, settings.fast_model, "fast routing")
    else:
        fast_t = eval_t
    if need_stt:
        stt_t = _target(keys, settings.stt_provider, settings.stt_model, "transcription")
    else:
        stt_t = eval_t
    return AIConfig(eval=eval_t, fast=fast_t, stt=stt_t)
