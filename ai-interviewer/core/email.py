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
        f'border-radius:10px;background:#13211e;border:1px solid #21332f;color:#ecf4f0;'
        f'font:600 26px/56px ui-monospace,Menlo,Consolas,monospace;text-align:center">{d}</div></td>'
        for d in code
    )
    app = html.escape(APP_NAME)
    return f"""\
<!doctype html>
<html><body style="margin:0;background:#07100f;padding:40px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#0f1a18;border:1px solid #21332f;border-radius:20px">
      <tr><td style="padding:36px 36px 8px">
        <div style="font:400 22px Georgia,serif;color:#ecf4f0">{app}</div>
      </td></tr>
      <tr><td style="padding:12px 36px 0">
        <div style="font-size:16px;color:#ecf4f0;font-weight:600">Your sign-in code</div>
        <div style="font-size:14px;color:#93a8a1;line-height:1.6;margin-top:6px">
          Enter this code to sign in. It expires in {OTP_TTL_MINUTES} minutes.
        </div>
      </td></tr>
      <tr><td align="center" style="padding:28px 36px">
        <table role="presentation" cellspacing="0" cellpadding="0"><tr>{digits}</tr></table>
      </td></tr>
      <tr><td style="padding:0 36px 32px;font-size:12px;color:#93a8a1;line-height:1.6">
        If you didn't request this, you can ignore this email — nobody can sign in without the code.
        <br><a href="{html.escape(APP_URL)}" style="color:#2dd4a7;text-decoration:none">{html.escape(APP_URL)}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _report_html(name: str, job_title: str, link: str, hours: int) -> str:
    app, who, role, url = (html.escape(v) for v in (APP_NAME, name or "there", job_title, link))
    return f"""\
<!doctype html>
<html><body style="margin:0;background:#07100f;padding:40px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#0f1a18;border:1px solid #21332f;border-radius:20px">
      <tr><td style="padding:36px 36px 8px">
        <div style="font:400 22px Georgia,serif;color:#ecf4f0">{app}</div>
      </td></tr>
      <tr><td style="padding:12px 36px 0">
        <div style="font-size:16px;color:#ecf4f0;font-weight:600">Your interview report is ready</div>
        <div style="font-size:14px;color:#93a8a1;line-height:1.6;margin-top:6px">
          Hi {who}, we've finished analysing your {role} practice interview.
          Your scores and feedback are waiting for you.
        </div>
      </td></tr>
      <tr><td align="center" style="padding:28px 36px">
        <a href="{url}" style="display:inline-block;background:#2dd4a7;color:#04201a;font-size:15px;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:12px">View my report</a>
      </td></tr>
      <tr><td style="padding:0 36px 32px;font-size:12px;color:#93a8a1;line-height:1.6">
        For your privacy, this report is deleted after {hours} hours — download the PDF if you'd like to keep it.
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
    _send(to_email, subject, _otp_html(code), (
        f"Your {APP_NAME} sign-in code is {code}. It expires in {OTP_TTL_MINUTES} minutes.\n"
        "If you didn't request this, ignore this email."
    ), "otp")


def send_report_ready_email(to_email: str, name: str, job_title: str, session_id: str, hours: int) -> None:
    link = f"{APP_URL}/app?report={session_id}"
    if not BREVO_API_KEY:
        print(f"\n[dev] Report ready for {to_email}: {link}\n", flush=True)
        return
    _send(to_email, f"Your {APP_NAME} interview report is ready", _report_html(name, job_title, link, hours), (
        f"Your {job_title} practice interview report is ready: {link}\n"
        f"It's deleted after {hours} hours, so download the PDF if you'd like to keep it."
    ), "report")


def _send(to_email: str, subject: str, html_content: str, text_content: str, tag: str) -> None:
    payload = {
        "sender": {"email": EMAIL_FROM_ADDRESS, "name": EMAIL_FROM_NAME},
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": html_content,
        "textContent": text_content,
        "tags": [tag],
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
