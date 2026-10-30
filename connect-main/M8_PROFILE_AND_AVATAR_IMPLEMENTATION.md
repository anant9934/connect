# M8 PROFILE AND AVATAR IMPLEMENTATION
## Tathastu Meet — Real Account Identity, Avatar Asset Registry & Persistence

---

### Executive Summary

Milestone M8 delivers a comprehensive profile management and avatar selection system for **Tathastu Meet**. The implementation directly incorporates the user-supplied 3D character avatars from `E:\Tathastu connect\profile avtar`, bundling both high-resolution native assets and optimized 256×256 thumbnails for fast UI rendering. Avatar selection, custom photo uploading, and display-name updates are fully wired to a centralized profile service with server-authoritative PostgreSQL persistence.

---

### 1. Avatar Asset Audit & Inventory

The local folder `E:\Tathastu connect\profile avtar` was systematically audited:

| # | Local Source Filename | Dimensions | Aspect Ratio | Format | Alpha Channel | Optimization | Stable Asset ID |
|---|---|---|---|---|---|---|---|
| 1 | `profile avtar 1.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_01` |
| 2 | `profile avtar 2.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_02` |
| 3 | `profile avtar 3.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_03` |
| 4 | `profile avtar 4.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_04` |
| 5 | `profile avtar 5.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_05` |
| 6 | `profile avtar 6.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_06` |
| 7 | `profile avtar 7.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_07` |
| 8 | `profile avtar 8.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_08` |
| 9 | `profile avtar 9.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_09` |
| 10 | `profile avtar 10.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_10` |
| 11 | `profile avtar 11.png` | 1254 × 1254 | 1:1 | PNG | Transparent | 256×256 Thumb | `avatar_11` |

#### Asset Management Rules Followed:
- Original facial artwork and colors were 100% preserved.
- No downloaded stock photos or fictional illustrations were introduced.
- Assets were bundled into `apps/mobile/assets/avatars/` with uniform lowercase snake_case naming.
- High-efficiency 256×256 thumbnails (~120KB each) were generated alongside full assets to ensure smooth 60fps scrolling and eliminate memory pressure on Android devices.

---

### 2. Avatar Registry Architecture (`avatarRegistry.ts`)

A type-safe avatar registry was established in `apps/mobile/src/services/avatarRegistry.ts`:

```typescript
export interface AvatarDefinition {
  id: string;
  name: string;
  source: ImageSourcePropType;
  thumbnail: ImageSourcePropType;
}

export const BUNDLED_AVATARS: AvatarDefinition[] = [
  { id: 'avatar_01', name: 'Avatar 1', source: require('../../assets/avatars/avatar_01.png'), thumbnail: require('../../assets/avatars/avatar_01_thumb.png') },
  // ... through avatar_11
];
```

#### Resolution Strategy:
1. If `avatarId` starts with `avatar_`, resolve directly to the bundled local asset via the registry.
2. If `avatarUrl` is provided, render via remote URI with caching headers.
3. If neither is set, dynamically generate initials from the authenticated user's `displayName` or `email` (e.g. "Anant Kumar" → "A", "Shivam" → "S") rendered on a brand-purple background (`#7444E8`).

---

### 3. Component Hierarchy

```
App.tsx
 └── LandingScreen.tsx
      ├── Header: ProfileAvatar (size 36) -> opens ProfileSheet
      └── Showcase: QuickMeetingAction (floating glass button)
 └── ProfileSheet.tsx (Bottom modal sheet)
      ├── Close Button (X) & Centered Title "My Profile"
      ├── Large ProfileAvatar (size 96) + Camera Badge
      ├── Display Name + Edit Pencil -> opens EditNameSheet
      ├── Email Display
      ├── AvatarPicker.tsx (Choose a profile picture card)
      │    ├── Upload Tile (expo-image-picker)
      │    ├── Primary Initials Tile
      │    ├── Secondary Initials Tile
      │    ├── Bundled Avatar Tiles (4 featured)
      │    └── More (...) Tile -> Full Gallery Modal (all 11 avatars)
      ├── Action Row 1: Edit name -> opens EditNameSheet
      ├── Action Row 2: Settings -> navigates to SettingsScreen
      ├── Action Row 3: Help & feedback -> opens support dialog
      └── Action Row 4: Logout (Coral/red row with session revocation)
```

---

### 4. Custom Photo Upload Workflow

When the user taps the **Upload** tile in `AvatarPicker`:
1. Launches `expo-image-picker` with `mediaTypes: Images`, `allowsEditing: true`, `aspect: [1, 1]`, `quality: 0.8`.
2. Validates image dimensions, file size (capped at 5MB), and MIME type (`image/jpeg`, `image/png`, `image/webp`).
3. Sends authenticated multipart/form-data request to `/api/v1/users/me/avatar`.
4. Updates local state immediately on 200 OK.
5. If the upload encounters a network failure, reverts optimistic UI cleanly with user notification.

---

### 5. Multi-Layer Persistence Architecture

```
User Action (Select Avatar or Edit Name)
  │
  ├── 1. Optimistic Local State Update (instant UI response)
  │
  ├── 2. Secure Storage Cache (AsyncStorage/SecureStore via storage.ts)
  │      └── Persists user profile JSON on device
  │
  └── 3. Authoritative Backend Synchronization
         └── PATCH /api/v1/users/me/profile
         └── PostgreSQL updates: avatar_id, avatar_url, display_name, updated_at
```

- **Cross-Device Consistency:** Server-authoritative profile data ensures the selected avatar and name sync across mobile, tablet, and web sessions.
- **Session Restore:** On app startup, stored credentials restore the session, fetch `/api/v1/users/me/profile`, and update local storage.
