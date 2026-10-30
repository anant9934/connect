# M8 GOOGLE AUTHENTICATION INTEGRATION & OWNER SETUP GUIDE
## Tathastu Meet — OAuth/OIDC Architecture, Backend Security & Google Cloud Console Setup

---

### Executive Summary

Milestone M8 establishes the native Google Authentication architecture for **Tathastu Meet** (`com.aitathastu.connect`). The frontend features a pixel-accurate **Continue with Google** action adhering to Google's official brand guidelines. The Go backend features server-authoritative token validation, preventing account takeover and ensuring client secrets are never exposed on mobile devices.

This document serves as the complete technical architecture reference and the official owner setup manual for configuring Google Cloud Console credentials.

---

### 1. Native UI Integration (`SignInScreen.tsx`)

A native **Continue with Google** button is integrated within both the "Sign In" and "Create Account" tabs:
- **Visual Design:** Full-width button with warm white background (`#FFFFFF`), subtle border (`#E5E3DC`), 12dp rounded corners, and official 4-color Google G mark (SVG vector rendering).
- **Typography:** 15sp `Inter-SemiBold` in `#17151F` reading "Continue with Google".
- **States:** Interactive press state, accessible 48dp height, active loading indicator (`ActivityIndicator color="#7444E8"`), and error banner feedback.
- **Graceful Unconfigured Mode:** If Google credentials have not yet been provided by the project owner in the environment, the button cleanly alerts the user:
  > *"Google Sign-In is awaiting Google Cloud Console OAuth configuration by the system administrator. Email/password authentication is fully active."*
  Zero crashes, zero fake successful logins.

---

### 2. Security Architecture & Threat Model

```
Mobile App (Android)                      Go Backend API                         Google OAuth / OIDC
    │                                           │                                         │
    ├── 1. Request Authorization Code ─────────┼────────────────────────────────────────>│
    │      (PKCE, state, nonce)                 │                                         │
    │<── 2. Auth Code / ID Token returned ──────┼─────────────────────────────────────────│
    │                                           │                                         │
    ├── 3. POST /api/v1/auth/google ───────────>│                                         │
    │      { idToken: "..." }                   │                                         │
    │                                           ├── 4. Fetch Google Public JWKS Keys ────>│
    │                                           │<── 5. Verify Signature, Issuer, Aud ────│
    │                                           │                                         │
    │                                           ├── 6. Extract Claims:                    │
    │                                           │      - sub (Stable Google User ID)      │
    │                                           │      - email & email_verified           │
    │                                           │      - name, picture                    │
    │                                           │                                         │
    │                                           ├── 7. Map / Create User in PostgreSQL    │
    │                                           │      (Safe linking, no takeover)        │
    │                                           │                                         │
    │                                           ├── 8. Generate Tathastu Session Token    │
    │<── 9. Return Session & User Profile ──────┘                                         │
```

#### Security Enforcements:
1. **Never Ship Secrets on Mobile:** The Android application never contains a Google Client Secret.
2. **Server-Side Verification:** The Go backend independently validates Google's signed JWT tokens against Google's public certs (`https://www.googleapis.com/oauth2/v3/certs`).
3. **Audience & Issuer Checks:** The token must have `iss` equal to `https://accounts.google.com` and `aud` matching the configured `GOOGLE_CLIENT_ID`.
4. **Account Takeover Prevention:** Accounts are bound by the immutable Google subject identifier (`sub`), stored in the `google_id` column. A client cannot claim another user's account simply by submitting their email address.
5. **Existing User Compatibility:** Users who previously registered with email/password can link their Google account from **Settings > Login & Accounts > Google**, provided they are authenticated.

---

### 3. Google Cloud Console Owner Setup Guide

Follow these exact steps in Google Cloud Console to activate production Google Sign-In:

#### Step 1: Create or Select Google Cloud Project
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown and select **New Project**.
3. Name: `Tathastu Meet` (or `tathastu-connect`).
4. Click **Create**.

#### Step 2: Configure OAuth Consent Screen
1. Navigate to **APIs & Services > OAuth consent screen**.
2. Select **External** and click **Create**.
3. Fill in App Information:
   - **App name:** `Tathastu Meet`
   - **User support email:** (Owner's email)
   - **App logo:** Upload Tathastu Meet icon.
   - **Application home page:** `https://connect.aitathastu.com`
   - **Application privacy policy:** `https://connect.aitathastu.com/privacy`
   - **Application terms of service:** `https://connect.aitathastu.com/terms`
   - **Authorized domains:** `aitathastu.com`
   - **Developer contact information:** (Owner's email)
4. Click **Save and Continue**.
5. Scopes: Add `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and `openid`.
6. Click **Save and Continue**.

#### Step 3: Create Android OAuth Client ID
1. Navigate to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Application type: **Android**.
4. Name: `Tathastu Meet Android App`.
5. Package name: `com.aitathastu.connect` *(must match exactly)*.
6. SHA-1 certificate fingerprint:
   - For Debug Keystore:
     ```bash
     keytool -keystore "%USERPROFILE%\.android\debug.keystore" -list -v -alias androiddebugkey -storepass android
     ```
   - For Release Keystore (from `apps/mobile/android/app/release.keystore`):
     ```bash
     keytool -keystore "e:\Tathastu connect\apps\mobile\android\app\release.keystore" -list -v -alias tathastu-release
     ```
   - Copy the SHA-1 hexadecimal fingerprint and paste it into the console.
7. Click **Create**.

#### Step 4: Create Web Application OAuth Client ID (for Server Verification)
1. In **Credentials**, click **Create Credentials > OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Tathastu Meet Backend / Web`.
4. Authorized JavaScript origins:
   - `https://connect.aitathastu.com`
   - `http://localhost:3000` *(for local web testing)*
5. Authorized redirect URIs:
   - `https://connect.aitathastu.com/api/auth/callback/google`
   - `com.aitathastu.connect:/oauthredirect`
6. Click **Create**.
7. Copy both the **Client ID** and **Client Secret**.

---

### 4. Environment Variables Configuration

#### 4.1 Go Backend (`services/api/.env` / Render Dashboard)
```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-YOUR_CLIENT_SECRET
GOOGLE_REDIRECT_URL=https://connect.aitathastu.com/api/auth/callback/google
```

#### 4.2 Mobile Application (`apps/mobile/.env`)
```env
# Google OAuth Client IDs (Public)
EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID=YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

---

### 5. Verification Checklist

| Gate | Requirement | Status |
|---|---|---|
| UI Fidelity | Continue with Google button matches branding and specs | **VERIFIED** |
| Error Handling | Unconfigured state displays clear informative alert | **VERIFIED** |
| Schema Support | `users` table includes `google_id`, `auth_provider`, nullable `password_hash` | **VERIFIED** |
| Token Security | Validation happens on server via cryptographically checked claims | **VERIFIED** |
| Password Isolation | Google-only accounts do not claim false password configuration | **VERIFIED** |
| Owner Setup Manual | Comprehensive step-by-step setup documentation produced | **VERIFIED** |
