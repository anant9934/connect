# Tathastu Meet — M4 Mobile Design System & Responsive Spec

**Source of Truth:** Production Website (`https://connect.aitathastu.com`)  
**Design Tokens Location:** [`packages/ui/src/tokens.ts`](file:///E:/Tathastu%20connect/packages/ui/src/tokens.ts) and [`apps/mobile/src/tokens.ts`](file:///E:/Tathastu%20connect/apps/mobile/src/tokens.ts)  
**Target Device Classes:** Phone Portrait (<600dp), Tablet Portrait (600–840dp), Tablet Landscape (>840dp)  

---

## 1. Visual Standard & Brand Tokens

Tathastu Meet's design language is defined by a warm light-first palette, disciplined typographic weight, crisp rounded surfaces, and purposeful category accents. It avoids neon or cyberpunk aesthetics, dark modes outside meeting media stages, and arbitrary visual clutter.

### 1.1 Color Palette

| Token Name | Hex Code | Role / Usage |
| :--- | :--- | :--- |
| **Primary Near-Black** | `#17151F` | Primary text, brand logo container, Instant Meet category |
| **Primary Yellow** | `#FFC93C` | Hero "real room" highlight badge, primary "Start a meeting" CTA button |
| **Yellow Hover** | `#F2BD31` | Interactive pressed state |
| **Yellow Surface** | `#FFF4D1` | Mentor Session card background, hero pill background |
| **Yellow Text** | `#6B4E00` | High-contrast label text on yellow surfaces |
| **Violet Primary** | `#7444E8` | Secondary "Join" CTA button, Research Room badge, brand accent |
| **Violet Surface** | `#F1EBFF` | Research Room card background, speaker tile border/glow |
| **Violet Text** | `#5A2FC7` | High-contrast label text on violet surfaces |
| **Mint Primary** | `#2DBE74` | Project Room accent, speaking live pulse dot, success status |
| **Mint Light** | `#86E3A8` | Meeting control active indicator |
| **Mint Surface** | `#E4F8EB` | Project Room card background, meeting timer pill |
| **Mint Text** | `#1F6B3B` | High-contrast label text on mint surfaces |
| **Coral Primary** | `#FF6B6B` | Community Room accent, leave meeting control |
| **Coral Surface** | `#FFE9E9` | Community Room card background, error banner fill |
| **Coral Text** | `#9B2C2C` | Error text, destructive action label |
| **Warm Background** | `#FAF9FC` | Mobile root view background |
| **Warm Off-White** | `#FCFCFA` | Secondary section background |
| **Card Surface** | `#FFFFFF` | Crisp elevated surfaces, input fields, header bar |
| **Borders** | `#E3E0D8` | Form inputs, card strokes, divider lines |
| **Muted Text** | `#5E5A50` | Body copy, secondary descriptions |
| **Subtle Text** | `#9C988D` | Input placeholders, metadata captions |

---

## 2. Typography Hierarchy

* **Heading Font:** Bricolage Grotesque (Heavy weights: 800, 900)
* **Body Font:** DM Sans (Medium, SemiBold, Bold: 500, 600, 700)
* **Code / Room Codes:** JetBrains Mono (SemiBold: 600)

| Scale Step | Phone Size / LineHeight | Tablet Size / LineHeight | Weight | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- |
| **Hero Display** | 34px / 40px | 54–68px / 60–74px | 900 (Black) | -1.0px to -1.8px |
| **Section Title** | 24px / 30px | 32–36px / 38–42px | 800 (ExtraBold) | -0.8px to -1.2px |
| **Card Heading** | 17px / 22px | 18–20px / 24px | 800 (ExtraBold) | -0.3px |
| **Body Large** | 16px / 24px | 18–19px / 28px | 500 (Medium) | Normal |
| **Body Standard** | 14px / 20px | 15px / 22px | 500 (Medium) | Normal |
| **Caption / Badge** | 11–12px / 16px | 12–13px / 18px | 700 (Bold) | +0.5px to +0.8px |

---

## 3. Responsive Layout Specifications

### 3.1 Device Breakpoints
* **Small Phone (<360dp):** Single column stacked, compact padding (12px), min touch target 48dp.
* **Standard Phone (360–480dp):** Single column stacked, 16px padding, primary actions directly visible without deep scrolling.
* **Tablet Portrait (600–840dp):** Centered bounded container (`maxWidth: 960px`), two-column adaptive grids, horizontal action rows (`Start Meeting` + `Room Code Join` side-by-side).
* **Tablet Landscape (>840dp):** Centered bounded container (`maxWidth: 1080px`), three-column feature cards, split composition for prejoin preview and controls.

### 3.2 Anti-Patterns Eliminated
1. **No `justifyContent: 'space-between'` on root screen containers:** Components are laid out using natural vertical rhythm and bounded margins.
2. **No full-width unconstrained buttons on tablets:** Maximum button width is constrained to 320–360dp, maintaining ergonomic touch targets.
3. **No controls hidden behind software keyboards:** Forms are wrapped in `KeyboardAvoidingView` + `ScrollView` with `keyboardShouldPersistTaps="handled"`.
4. **No microscopic tablet text:** Heading and body typography scale responsively via density-independent dimensions.
