# M8 AUTHENTICATED UI REFERENCE AUDIT
## Tathastu Meet — Pixel-Faithful Reference Design Verification & Mapping

---

### Executive Summary

Milestone M8 establishes the authenticated user experience for **Tathastu Meet** (`com.aitathastu.connect`), faithfully reproducing the approved three-screen reference specification (`Tathastu Meet App UI Redesign (1).png`) in native React Native without invented widgets, fake tabs, unrequested dark modes, or duplicate settings entries.

This audit details the structural, visual, and behavioral mapping between each panel of the approved reference design and the production implementation in `apps/mobile`.

---

### 1. Three-Screen Reference Design Analysis

```
┌─────────────────────────────────┐   ┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│ SCREEN 1: AUTHENTICATED HOME   │   │ SCREEN 2: MY PROFILE SHEET      │   │ SCREEN 3: SETTINGS SCREEN       │
│                                 │   │                                 │   │                                 │
│ [Logo] Tathastu Meet       (S)  │   │   (X)         My Profile            │   │  <  Settings                    │
│                                 │   │                                 │   │                                 │
│ Feels like a [real room] talk.  │   │             (  S  ) [📷]        │   │ Account                         │
│                                 │   │             Anant Kumar ✏️      │   │  👤 Profile info             >  │
│ [ Room code... ]       [Join]   │   │         anantkumar@gmail.com    │   │  ✏️ Change name              >  │
│                                 │   │                                 │   │  🖼️ Choose profile picture   >  │
│ [Instant][Research][Project]... │   │ ┌─────────────────────────────┐ │   │  ✉️ Email    anantk..@gmail. >  │
│                                 │   │ │ Choose a profile picture    │ │   │                                 │
│ ┌─────────────────────────────┐ │   │ │ [↑] (S) (A) (👦) (👨)       │ │   │ Security                        │
│ │ Federated Learning Collab   │ │   │ │ (👩) (👨) (🧑) (...)        │ │   │  🔒 Change password          >  │
│ │ ┌─────────────────────────┐ │ │   │ └─────────────────────────────┘ │   │  🔑 Forgot password          >  │
│ │ │           (A)           │ │ │   │                                 │   │                                 │
│ │ │ "What if we federate.." │ │ │   │ 👤 Edit name                 >  │   │ Login & Accounts                │
│ │ └─────────────────────────┘ │ │   │ ⚙️ Settings                  >  │   │  G  Google       Connected   >  │
│ │                         [📹+] │   │ ❓ Help & feedback           >  │   │  ✉️ Email & Pass Connected   >  │
│ └─────────────────────────────┘ │   │ 🚪 Logout                       │   │                                 │
└─────────────────────────────────┘   └─────────────────────────────────┘   └─────────────────────────────────┘
```

---

### 2. Screen 1: Authenticated Homepage Header & Showcase

#### 2.1 Header Geometry & Content
| Reference Element | Implementation in `LandingScreen.tsx` | Verification Status |
|---|---|---|
| Left: Tathastu Meet App Icon | `AppLogoIcon` (M7.4 golden/purple logo) | **PASS** — Preserved approved brand icon |
| Left: Brand Title | `Text style={styles.brandTitleText}>Tathastu Meet</Text>` | **PASS** — Inter-Bold typography |
| Right: Single Circular Avatar | `ProfileAvatar` (size 36, touchable >= 44dp) | **PASS** — Authoritative account initials/photo |
| Unauthenticated Actions Removed | `Sign out`, `Start free`, `Starting...` hidden when authenticated | **PASS** — Moved into profile sheet & meeting actions |
| Guest Header Intact | When `!isAuthenticated`, renders `Sign in` + `Start free` | **PASS** — Preserved exact guest flow |

#### 2.2 Floating Quick Meeting Glass Action
| Reference Element | Implementation in `QuickMeetingAction.tsx` | Verification Status |
|---|---|---|
| Visual Surface | 48×48dp circular glass button, translucent purple tint (`rgba(116, 68, 232, 0.22)`) | **PASS** — Android-compatible border & shadow |
| Icon | Lucide-style Video camera with plus badge (`#7444E8`) | **PASS** — Crisp vector rendering |
| Position | Floating bottom-right of Federated Learning showcase card | **PASS** — Safe from text bubbles and labels |
| Action Sheet | Opens modal with "New meeting" and "Join with a code" | **PASS** — Connected to real backend room engine |

---

### 3. Screen 2: My Profile Sheet (`ProfileSheet.tsx`)

#### 3.1 Modal Sheet Backdrop & Surface
- **Presentation:** Near full-height bottom modal sheet (`maxHeight: '92%'`).
- **Surface:** Rounded top corners (`borderTopLeftRadius: 32`, `borderTopRightRadius: 32`), warm white card surface (`#FFFFFF`), subtle frosted glass backdrop (`rgba(23, 21, 31, 0.45)`).
- **Navigation Controls:** Left-aligned circular close button with `<X size={20} color="#17151F" />`.
- **Title:** Centered `My Profile` in `Inter-Bold`, 18sp.

#### 3.2 Account Identity Header
- **Large Avatar:** 96×96dp circular avatar with dynamic initials fallback (`#7444E8`) or bundled/uploaded image.
- **Camera Affordance:** Small circular edit badge (28×28dp) overlapping bottom-right edge of avatar (`#17151F` with white camera icon).
- **Display Name:** Real authenticated display name (e.g. "Anant Kumar") + small pencil edit icon (`#6B675C`). Tapping opens `EditNameSheet`.
- **Email:** Real authenticated account email in `#6B675C` (14sp).

#### 3.3 "Choose a profile picture" Card (`AvatarPicker.tsx`)
- **Card Container:** White rounded surface (`borderRadius: 20`, `padding: 16`), subtle border (`#E9E7E1`).
- **Tile Grid (2 rows × 4 columns):**
  1. `Upload Tile`: Outlined card with upload arrow (`Upload` label).
  2. `Current Initials Avatar`: Primary user initial (`S` in reference) with purple selection ring.
  3. `Secondary Initials Avatar`: Accent user initial (`A` in reference).
  4. `Avatar 1`: Bundled native character from local folder.
  5. `Avatar 2`: Bundled native character.
  6. `Avatar 3`: Bundled native character.
  7. `Avatar 4`: Bundled native character.
  8. `More (...) Tile`: Opens full gallery modal showing all 11 approved assets.
- **Selected State:** Active purple ring (`borderWidth: 2`, `borderColor: '#7444E8'`).

#### 3.4 Action Rows — Strict 4-Row Specification
The reference design was strictly audited. The unrequested duplicate row `Account settings` was **explicitly omitted**:
1. **Edit name** (`User` icon) → Opens `EditNameSheet` modal.
2. **Settings** (`Settings` gear icon) → Navigates to full Settings screen.
3. **Help & feedback** (`HelpCircle` icon) → Opens support modal dialog.
4. **Logout** (`LogOut` icon) → Lightly tinted coral/red row (`#FFF2F0` background, `#D9383A` text/icon), executes real session revocation.

---

### 4. Screen 3: Settings Screen (`SettingsScreen.tsx`)

#### 4.1 Header & Structure
- **Navigation:** Back chevron `<` + left-aligned `Settings` title (22sp `Inter-Bold`).
- **Background:** Crisp warm white `#FBFBFA`.
- **Card Containers:** 4 grouped white cards (`borderRadius: 16`, `borderWidth: 1`, `borderColor: '#EFEFEA'`) with subtle row dividers (`#F5F5F0`).

#### 4.2 Group Breakdown & Behavior

| Group | Row | Icon | Right Value / Control | Action / Backend Integration |
|---|---|---|---|---|
| **Account** | Profile information | User | `>` chevron | Opens read-only account metadata sheet |
| | Change name | Edit3 | `>` chevron | Opens shared `EditNameSheet` |
| | Choose profile picture | Image | `>` chevron | Opens shared `AvatarPicker` sheet |
| | Email | Mail | Real email + `>` | Shows verified account email |
| **Security** | Change password | Lock | `>` chevron | Opens Argon2id reauth & password update sheet |
| | Forgot password | Key | `>` chevron | Opens password recovery dialog |
| **Login & Accounts** | Google | Google SVG | `Connected` / `Not connected` | Reflects true backend Google ID link state |
| | Email & Password | Mail | `Connected` / `Not connected` | Reflects presence of password credentials |
| **Preferences** | Audio & Video | Video | `>` chevron | Opens mic/camera default & facing toggles |
| | Notifications | Bell | `>` chevron | Opens notification preferences sheet |
| | Appearance | Palette | `Light >` | System/Light theme selector |
| | Language | Globe | `English >` | Language selector |

---

### 5. Architectural Compliance & Non-Regression Summary

1. **Zero Invented Features:** No bottom tab bar, no dark-theme takeover, no fake analytics.
2. **Strict Identity Integrity:** No hardcoded names or emails; all UI binds to central `UserProfile` state.
3. **Truth-Authoritative Statuses:** Google connection accurately displays `Not connected` until genuinely linked via backend OAuth.
4. **Zero LiveKit Media Regression:** Codec configuration, AudioSession routing, and screen sharing remain completely untouched.
