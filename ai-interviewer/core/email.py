"""Transactional email via Brevo (https://developers.brevo.com/reference/sendtransacemail)."""
import html
import logging

import httpx

from core.config import APP_NAME, APP_URL, BREVO_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, OTP_TTL_MINUTES

log = logging.getLogger("tejaskrit.email")

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"


class EmailError(RuntimeError):
    pass


def _otp_html(code: str) -> str:
    digits = "".join(
        f'<td style="padding:0 4px"><div style="width:44px;height:56px;line-height:56px;'
        f'border-radius:10px;background:#1b1a2e;border:1px solid #2e2c4a;color:#f4f3ff;'
        f'font:600 26px/56px ui-monospace,Menlo,Consolas,monospace;text-align:center">{d}</div></td>'
        for d in code
    )
    app = html.escape(APP_NAME)
    return f"""\
<!doctype html>
<html><body style="margin:0;background:#0a0a0f;padding:40px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#111118;border:1px solid #23222f;border-radius:20px">
      <tr><td style="padding:36px 36px 8px">
        <div style="font:400 22px Georgia,serif;color:#f4f3ff">{app}</div>
      </td></tr>
      <tr><td style="padding:12px 36px 0">
        <div style="font-size:16px;color:#f4f3ff;font-weight:600">Your sign-in code</div>
        <div style="font-size:14px;color:#a3a1bd;line-height:1.6;margin-top:6px">
          Enter this code to sign in. It expires in {OTP_TTL_MINUTES} minutes.
        </div>
      </td></tr>
      <tr><td align="center" style="padding:28px 36px">
        <table role="presentation" cellspacing="0" cellpadding="0"><tr>{digits}</tr></table>
      </td></tr>
      <tr><td style="padding:0 36px 32px;font-size:12px;color:#77758f;line-height:1.6">
        If you didn't request this, you can ignore this email — nobody can sign in without the code.
        <br><a href="{html.escape(APP_URL)}" style="color:#9d8cff;text-decoration:none">{html.escape(APP_URL)}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def send_otp_email(to_email: str, code: str) -> None:
    subject = f"{code} is your {APP_NAME} sign-in code"
    if not BREVO_API_KEY:
        # Development only — config.py refuses to start production without Brevo.
        log.warning("BREVO_API_KEY not set — OTP for %s is %s", to_email, code)
        print(f"\n[dev] OTP for {to_email}: {code}\n", flush=True)
        return

    payload = {
        "sender": {"email": EMAIL_FROM_ADDRESS, "name": EMAIL_FROM_NAME},
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": _otp_html(code),
        "textContent": (
            f"Your {APP_NAME} sign-in code is {code}. It expires in {OTP_TTL_MINUTES} minutes.\n"
            "If you didn't request this, ignore this email."
        ),
        "tags": ["otp"],
    }
    try:
        resp = httpx.post(
            BREVO_SEND_URL,
            json=payload,
            headers={"api-key": BREVO_API_KEY, "accept": "application/json"},
            timeout=15,
        )
    except httpx.HTTPError as e:
        log.error("Brevo request failed: %s", e)
        raise EmailError("Couldn't reach the email service. Please try again.") from e
    if resp.status_code not in (200, 201, 202):
        log.error("Brevo rejected email (%s): %s", resp.status_code, resp.text[:500])
        raise EmailError("The email service rejected the request. Please try again later.")
