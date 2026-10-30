# M8 SETTINGS AND NAVIGATION ARCHITECTURE
## Tathastu Meet — Screen 3 Settings Hierarchy, Account Security & Persistent Preferences

---

### Executive Summary

Milestone M8 implements the complete **Settings** screen for **Tathastu Meet**, perfectly matching the third panel of the approved reference design (`Tathastu Meet App UI Redesign (1).png`). The screen replaces all mock buttons with working interactive controls, connects security flows to backend Argon2id password hashing, enforces authoritative authentication provider status reporting, and persists user meeting preferences.

---

### 1. Visual Specification & Design Token Alignment

- **Surface & Background:** Warm white `#FBFBFA` background, grouped cards in `#FFFFFF` with `borderWidth: 1`, `borderColor: '#EFEFEA'`, and soft radius `16dp`.
- **Typography:** Section titles in 13sp uppercase `Inter-Bold` (`#6B675C`), row labels in 15sp `Inter-SemiBold` (`#17151F`), secondary values in 14sp `Inter-Regular` (`#6B675C`).
- **Icons:** Minimalist 20dp stroke-based Lucide icons (`User`, `Edit3`, `Image`, `Mail`, `Lock`, `Key`, `Video`, `Bell`, `Palette`, `Globe`).
- **Dividers:** 1dp subtle dividers (`#F5F5F0`) between rows within a card.
- **Chevrons:** Standard right-pointing chevrons (`#B0ADA5`) with accessible 48dp touch targets.

---

### 2. Group Hierarchy & Functional Behaviors

```
SETTINGS SCREEN (< Back Arrow, Title "Settings")
 │
 ├── GROUP 1: ACCOUNT
 │    ├── Profile information  ──> Opens Read-Only Account Identity Modal
 │    ├── Change name          ──> Opens Shared EditNameSheet (2-50 chars, backend PATCH)
 │    ├── Choose profile pic   ──> Opens Shared AvatarPicker Sheet (11 bundled + upload)
 │    └── Email                ──> Displays authenticated user's email (right-aligned)
 │
 ├── GROUP 2: SECURITY
 │    ├── Change password      ──> Opens Change Password Sheet (Current + New, Argon2id)
 │    └── Forgot password      ──> Opens Password Recovery Modal (Safe rate-limited reset)
 │
 ├── GROUP 3: LOGIN & ACCOUNTS
 │    ├── Google               ──> Shows "Connected" ONLY if linked in backend, else "Not connected"
 │    └── Email & Password     ──> Shows "Connected" if user has password credentials
 │
 └── GROUP 4: PREFERENCES
      ├── Audio & Video        ──> Opens Preferences Sheet (Mic default, Cam default, Facing)
      ├── Notifications        ──> Opens Notification Toggle Sheet
      ├── Appearance           ──> Shows "Light >" (Theme selector)
      └── Language             ──> Shows "English >" (Locale selector)
```

---

### 3. Deep-Dive: Individual Section Implementation

#### 3.1 Group 1 — Account
- **Profile information:** Displays user ID (shortened format), registered date, verified email, display name, and active auth provider.
- **Change name:** Reuses the shared `EditNameSheet` component to ensure a single, consistent code path for name updates across the application.
- **Choose profile picture:** Reuses the shared `AvatarPicker` component; selections immediately sync to central state and server.
- **Email:** Renders the user's authoritative email address with truncation protection (`anantk...@gmail.com`) on narrow screens. Direct email modification without verification is strictly prevented.

#### 3.2 Group 2 — Security
- **Change password:**
  - Validates current password via authenticated reauthentication endpoint.
  - Enforces password strength (minimum 8 characters).
  - Updates password hash via server-side Argon2id key derivation.
  - Handles session rotation smoothly.
- **Forgot password:**
  - Provides a secure email recovery trigger.
  - Implements anti-enumeration: responses are uniform whether the email exists or not.
  - Displays appropriate server configuration status when SMTP/delivery services are in configuration mode.

#### 3.3 Group 3 — Login & Accounts
- **Zero Fabrication Rule:** Google connection status is **never** hardcoded to "Connected".
  - If `user.googleId` is present and verified by the backend → `Connected` in emerald green (`#10B981`).
  - If not linked → `Not connected` in neutral gray (`#6B675C`). Tapping initiates OAuth account linking.
- **Email & Password:** Reflects whether the user registered via password credentials or OAuth-only.

#### 3.4 Group 4 — Preferences
- **Audio & Video:**
  - Default Microphone State: `muted` vs `unmuted` (persisted in `storage.ts` and synced to `PrejoinScreen`).
  - Default Camera State: `enabled` vs `disabled` (persisted and honored during room entry).
  - Default Camera Facing: `front` vs `back`.
  - Zero disruption to LiveKit media pipelines: preferences set initial state flags before media negotiation.
- **Notifications:** Meeting reminder alerts and in-call chat sound toggles.
- **Appearance:** Enforces approved Tathastu Meet light theme as default; system light/dark selector.
- **Language:** English (`en-US`) accurately declared; ready for i18n expansion without fabricated mock translations.

---

### 4. Navigation Integrity & Back Handling

- **Back Arrow:** Returns directly to the previous screen (either `ProfileSheet` or `LandingScreen`).
- **Android Hardware Back:** Wire-wrapped to `BackHandler` in `SettingsScreen.tsx` to ensure predictable dismissals.
- **State Preservation:** Navigating to and from Settings preserves active modal inputs and does not trigger session refreshes.
- **Omission of Duplicates:** The unrequested duplicate row `Account settings` (which was present in earlier drafts) was **completely eliminated** from both `ProfileSheet` and `SettingsScreen`.
