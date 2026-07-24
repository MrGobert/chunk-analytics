"""
Firebase authentication for the eval account.

Signs in with email/password via the Firebase Auth REST API and hands out
ID tokens for Bearer auth against cerebral. Tokens live 1 hour; a full suite
run can take ~30 minutes, so the identity proactively re-signs-in when the
token is close to expiry.
"""

import logging
import time
from dataclasses import dataclass, field

import httpx

from evals import config

SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"

# Re-sign-in when fewer than this many seconds remain on the token.
REFRESH_MARGIN_SECONDS = 600


class EvalAuthError(Exception):
    pass


@dataclass
class EvalIdentity:
    uid: str
    email: str
    id_token: str = field(repr=False)
    expires_at: float = 0.0  # epoch seconds

    def token(self) -> str:
        """Return a valid ID token, re-signing-in if it is near expiry."""
        if time.time() > self.expires_at - REFRESH_MARGIN_SECONDS:
            fresh = sign_in()
            self.id_token = fresh.id_token
            self.expires_at = fresh.expires_at
        return self.id_token

    def force_refresh(self) -> str:
        """Re-sign-in unconditionally (used after a 401 from cerebral)."""
        fresh = sign_in()
        self.id_token = fresh.id_token
        self.expires_at = fresh.expires_at
        return self.id_token


def sign_in() -> EvalIdentity:
    """Sign in the eval account and return its identity."""
    ok, problem = config.is_configured()
    if not ok:
        raise EvalAuthError(f"eval account not configured: {problem}")

    try:
        response = httpx.post(
            SIGN_IN_URL,
            params={"key": config.firebase_web_api_key()},
            json={
                "email": config.eval_email(),
                "password": config.eval_password(),
                "returnSecureToken": True,
            },
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        raise EvalAuthError(f"Firebase sign-in request failed: {exc}") from exc

    if response.status_code != 200:
        # Firebase returns {"error": {"message": "INVALID_PASSWORD"}} etc.
        detail = ""
        try:
            detail = response.json().get("error", {}).get("message", "")
        except Exception:
            pass
        raise EvalAuthError(
            f"Firebase sign-in rejected ({response.status_code}): {detail}"
        )

    data = response.json()
    expires_in = int(data.get("expiresIn", "3600"))
    identity = EvalIdentity(
        uid=data["localId"],
        email=data.get("email", config.eval_email()),
        id_token=data["idToken"],
        expires_at=time.time() + expires_in,
    )
    logging.info(f"[EVALS] signed in eval account uid={identity.uid}")
    return identity
