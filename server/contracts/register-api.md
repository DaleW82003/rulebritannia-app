# POST /api/register — API Contract

## Summary

Public endpoint for new user registration. Rate-limited to 5 requests per IP per hour.
No session or CSRF token is required.

---

## Request

**Method:** `POST`  
**Path:** `/api/register`  
**Content-Type:** `application/json`

### Body fields

| Field             | Type    | Required | Description                                      |
|-------------------|---------|----------|--------------------------------------------------|
| `name`            | string  | ✅        | Display name (max 100 characters)                |
| `username`        | string  | ✅        | 3–30 chars: letters, numbers, `_`, `-`           |
| `email`           | string  | ✅        | Valid email address (max 254 characters)         |
| `password`        | string  | ✅        | Minimum 8 characters                            |
| `age_attested`    | boolean | ✅        | Must be `true` (user confirms they are 16+)      |
| `marketing_opt_in`| boolean | ❌        | Optional email marketing consent (default false) |
| `turnstile_token` | string  | ❌*       | Cloudflare Turnstile token (required when `TURNSTILE_ENABLED=true`) |

---

## Responses

All success and error responses use `Content-Type: application/json`.

### 200 OK — Application received

Returned for both new and duplicate submissions (to avoid email enumeration).

```json
{
  "ok": true,
  "message": "Your application has been submitted. Please check your email to verify your address, then wait for admin approval before logging in."
}
```

### 400 Bad Request — Validation error

```json
{ "ok": false, "error": "<human-readable reason>" }
```

Possible errors:
- `"All fields are required."`
- `"Username must be 3–30 characters: letters, numbers, underscores, or hyphens only."`
- `"A valid email address is required."`
- `"Password must be at least 8 characters."`
- `"You must confirm you are 16 or older."`
- `"Anti-bot check failed. Please try again."` (Turnstile enabled and token invalid)

### 429 Too Many Requests — Rate limit exceeded

Returned by `express-rate-limit` when > 5 requests from the same IP within 1 hour.
No JSON body (Express default).

### 500 Internal Server Error — Unexpected server error

```json
{ "ok": false, "error": "Server error. Please try again later." }
```

---

## Frontend contract

The registration page (`js/pages/register.js`) handles the response as follows:

- **Success**: `resp.ok` AND `json.ok !== false` → show confirmation UI.
  Handles both `{ ok: true }` JSON and (for resilience) an empty 200 body.
- **Failure**: any other combination → display `json.error` or a generic message.

---

## Post-registration flow

1. On successful submission the server sends an email verification link (fire-and-forget).
2. The user must click the link before their account is active.
3. An admin must also approve the pending registration.
4. Login is blocked until **both** email verification and admin approval are complete.
