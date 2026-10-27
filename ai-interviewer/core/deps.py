"""FastAPI dependencies: database session and the signed-in user."""
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import SESSION_COOKIE_NAME
from core.db import AuthSession, User, as_utc, get_db, utcnow
from core.security import hash_token


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    row = db.execute(
        select(AuthSession, User)
        .join(User, User.id == AuthSession.user_id)
        .where(AuthSession.token_hash == hash_token(token))
    ).first()
    if not row:
        raise HTTPException(status_code=401, detail="Session expired — please sign in again")
    auth_session, user = row
    if as_utc(auth_session.expires_at) < utcnow():
        db.delete(auth_session)
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired — please sign in again")
    return user
