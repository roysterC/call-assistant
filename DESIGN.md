---
name: Kikai
description: The salon's front desk, in sage; the salon's own pages, in the salon's colour.
colors:
  sage-ink: "#2d331a"
  sage-deep: "#5b6635"
  sage-mid: "#88994f"
  sage-soft: "#acbb7b"
  sage-pale: "#ccd5ae"
  sage-hairline: "#e1e6cf"
  sage-field: "#d6debe"
  sage-wash: "#ebeedf"
  sage-ground: "#f5f7ef"
  paper: "#fbfbf4"
  surface: "#ffffff"
  diary-lane: "#f7f8f1"
  cornsilk: "#fefae0"
  bronze: "#d4a373"
  bronze-deep: "#64411f"
  now-orange: "#e5894b"
  family-manicure: "#3f88d4"
  family-sets: "#8a6fd4"
  family-pedicure: "#c47726"
  family-art: "#2f9455"
  salon-ink: "#16121A"
  salon-cream: "#FFF4E8"
  salon-muted: "#5A4F63"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"
    fontSize: "1.65rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  diary-time:
    fontFamily: "Inter, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  salon-display:
    fontFamily: "Bricolage Grotesque, Arial Narrow, sans-serif"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 75, 'opsz' 96"
  salon-text:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "9.6px"
  md: "12.8px"
  lg: "16px"
  xl: "22.4px"
  panel: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.sage-deep}"
    textColor: "#fffef9"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.sage-ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  button-ghost:
    textColor: "{colors.sage-ink}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.sage-ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "16px"
  nav-item:
    textColor: "{colors.sage-ink}"
    rounded: "14px"
    height: "40px"
  nav-item-active:
    backgroundColor: "{colors.sage-ink}"
    textColor: "{colors.cornsilk}"
    rounded: "14px"
  diary-booking:
    textColor: "{colors.sage-ink}"
    rounded: "12px"
    padding: "6px 8px"
  badge-count:
    backgroundColor: "{colors.bronze}"
    textColor: "#32210f"
    rounded: "{rounded.pill}"
    height: "20px"
  salon-button:
    backgroundColor: "{colors.salon-ink}"
    textColor: "{colors.salon-cream}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 24px"
---

# Design System: Kikai

Kikai has two visual worlds, and they never mix.

1. **The staff app** (everything behind sign-in: diary, conversations, clients, callbacks, sales, settings). This file's main subject.
2. **The salon's own pages** (`/s/<slug>`, the booking flow, the embed): the salon's brand, with Kikai as a quiet credit. See the last section.

## Overview

**Creative North Star: "The Sage Studio"**

A soft, natural workspace that a nail technician can glance at between clients and understand at once. Sage greens on a pale ground, rounded and unshowy: it should feel like the calm back room of a good salon, not a dashboard. The page sits on a raised, rounded panel beside a light sage menu; the page you are on is the one dark thing in the menu, a pill.

Calm is the method, not a mood board. Contrast is spent on what a busy person needs right now (the time a client is due, who is free, what is waiting) and withheld from everything else. Surfaces are separated by tone and hairlines, with the faintest shadows. Colour carries meaning (a treatment family, something waiting, the current time) and is never decoration.

Density is moderate: real working screens, not airy marketing layouts. They hold a day of five technicians, a client list, a settings page with many sections. The diary is the heart of the product and is designed to be read from a step back.

**Key Characteristics:**
- Light sage menu with a dark pill for the current page; content on a raised, rounded panel.
- Plus Jakarta Sans for titles, Inter for everything read; tabular figures for every time and price.
- Soft-and-calm components: hairline borders, faint shadows, gentle hovers, rounded corners from one radius token.
- The diary: one lane per technician, bookings as rounded cards tinted by treatment family.
- Works in English and Vietnamese; every face carries Vietnamese diacritics.

## Colors

One sage family from ink to ground, a single warm bronze for "something is waiting", and four treatment-family hues that live only in the diary.

### Primary
- **Sage Deep** (sage-deep): primary buttons, links, muted text on white (6.2:1), chart line one. The working colour of the app.
- **Sage Ink** (sage-ink): body text (13.1:1 on white), the current page's pill in the menu, the selected day in the date strip.

### Secondary
- **Waiting Bronze** (bronze): counts and dots for things waiting on a person (callbacks, notifications), always with dark bronze text (`#32210f`). Nothing else is this colour.

### Tertiary
- **Now Orange** (now-orange, the `--now` token): the current-time line and its pill in the diary, with ink text on the pill (5.0:1). Only that.
- **Treatment families** (family-manicure, family-sets, family-pedicure, family-art, plus a grey for "other"): a booking's border; its fill is a light solid tint of the same hue (`src/lib/service-colours.ts`, which validates them). Services within a family step through four shades of its hue.

### Neutral
- **Paper** (paper): the page panel and the app's canvas.
- **Sage Ground** (sage-ground): behind the panel, and the menu's own ground: the menu sits on the page's floor, the content is lifted off it.
- **Surface** (surface): cards, inputs, dialogs, the diary's grid.
- **Diary Lane** (diary-lane): a free stretch of a technician's column; closed or blocked time shows the diagonal stripes beneath.
- **Sage Hairline** (sage-hairline): borders and dividers. **Sage Field** (sage-field): input borders, a touch firmer. **Sage Wash** (sage-wash): hover and pressed surfaces.
- **Sage Mid** (sage-mid): focus rings.
- **Cornsilk** (cornsilk): text on the dark pill.

### Named Rules
**The One Warm Thing Rule.** Bronze means "a person is waiting". If it isn't a count or dot of things waiting, it isn't bronze.

**The Colour Is Data Rule.** Treatment hues appear only on bookings and their legend. A treatment's colour never decorates a heading, a button or a chart.

**The Red Is Stop Rule.** The palette has no colour that reads as "stop", so errors and destructive actions use the one red (`oklch(0.55 0.21 27)`). Waiting-too-long text uses it too, sparingly.

## Typography

**Display Font:** Plus Jakarta Sans (with Inter, then sans-serif)
**Body Font:** Inter (with its Vietnamese subset, then sans-serif)
**Mono Font:** JetBrains Mono, for codes and identifiers only

**Character:** a friendly geometric sans for titles over a workhorse sans for reading. Inter reads better at small sizes and has tabular figures for times and money. Plus Jakarta Sans sets its word space narrow, so headings get `word-spacing: 0.08em`.

### Hierarchy
- **Display** (600, 1.65rem, 1.25): the page title in PageHeader, one per page. No subtitle restating what the page is.
- **Title** (600, 0.95rem, 1.375): card and section titles.
- **Body** (400, 0.875rem, 1.5): everything read. 16px on iOS in text boxes, so the phone never zooms.
- **Small** (500 to 700, 13px): compact controls and list detail (filter chips, toggles, secondary lines in dense rows). The size between Label and Body.
- **Label** (500, 0.75rem): field labels, the second line of list rows, captions. Muted labels are Sage Deep, never grey.
- **Diary time** (800, 20px, tabular): a booking's start time, the largest thing on it, so the day can be read from a step back. The end time sits beside it at 12.5px.

### Named Rules
**The Tabular Rule.** Every time, price, count and booking number uses tabular figures.

**The One Title Rule.** A page has one display-size title. Sections below it use Title size.

## Layout

The app is a menu and a panel. On a laptop or larger the menu is a 248px column (a 76px icon rail when folded, and folded by default below 1280px) on the Sage Ground, and the page is a panel inset 12px from the window's edges with a 28px radius and the raised shadow. Pages either pad themselves to a max-width of 1280px (settings, sales, insights) or take the whole panel and scroll inside (diary, conversations, callbacks, clients).

On a phone (below 768px wide, or any screen under 500px tall) the menu becomes a light header (logo, notifications, language) and a floating tab bar along the bottom: a 68px pill, 16px in from the edges and clear of the home indicator, with the current tab as a dark bubble. Pages leave room for it at the bottom.

Spacing steps in 4px; groups are tight (8px), sections generous (24 to 32px). Touch targets are 44px or more on phones.

## Elevation & Depth

Tonal layering first, shadow second. The canvas, the panel and cards are three steps of the same pale family; hairlines separate rows. Shadows are faint and sage-tinted, never grey or black.

### Shadow Vocabulary
- **Surface** (`0 1px 2px rgb(45 51 26/.04), 0 1px 3px rgb(45 51 26/.04)`): cards and the diary grid at rest.
- **Raised** (`0 4px 6px -2px rgb(45 51 26/.05), 0 12px 24px -6px rgb(45 51 26/.10)`): the page panel, popovers, the phone's More sheet, alerts.
- **Booking** (`0 1px 2px rgb(45 51 26/.06), 0 4px 10px -4px rgb(45 51 26/.10)`): a booking card in the diary; deepens on hover.

### Named Rules
**The Nothing Heavier Rule.** No shadow darker than the Raised one. Anything heavier looks like a 2014 dashboard.

## Shapes

Rounded and soft, from one token: `--radius` is 16px, and the scale steps from it (sm 9.6, md 12.8, lg 16, xl 22.4px). The page panel and the menu are 28px; the phone's tab bar and badges are full pills; nav items are 14px. Borders are 1px hairlines; bookings and alerts take a 1.5px full border in their colour.

**The Whole Border Rule.** Colour goes round the whole shape or fills it. Never a stripe down one side of a rounded box.

## Components

### Buttons
- **Shape:** rounded from the radius token (16px, nearly a pill at 32px tall).
- **Primary:** Sage Deep with near-white text, a faint sage shadow; hover 90%.
- **Outline:** white with a Sage Field border; hover Sage Wash. **Ghost:** no fill until hover. **Destructive:** the red.
- **Pressed:** moves down 1px. **Focus:** a 3px Sage Mid ring at 50%.

### Cards / Containers
- **Corner Style:** 22.4px (xl). **Background:** white. **Shadow:** Surface. **Border:** a 1px Sage Hairline ring.
- **Internal Padding:** 16px, 12px for the small size.

### Inputs / Fields
- **Style:** white, a 1px Sage Field border, 16px radius, 32px tall.
- **Focus:** the border turns Sage Mid with a 3px ring. **Error:** red border and a red ring at 20%. **Disabled:** Sage Wash, 50%.

### Navigation
- **Menu:** light (`.sidebar-light`): Sage Ink names, Sage Deep icons and second lines, a Sage Wash hover; the current page a Sage Ink pill with cornsilk text. Counts are Waiting Bronze pills. The menu's colours are tokens (`--sidebar-*`), so the dark variant is one class away.
- **Phone:** the floating tab bar (Diary, Chats, Assistant, More); More opens a sheet of the rest.

### Chips
- **Filter chips** (clients, callbacks): full pills, white with a hairline; the selected one Sage Ink with white text and its count.

### The Diary (signature component)
- **Columns:** one lane per technician, separated by a 6px white gap, on the Diary Lane tint. Closed hours and blocked time show diagonal stripes; a technician's day off is hatched the same way with "Day off" in the lane. A day nobody can be booked says so once across the grid ("Closed", "Nobody's in").
- **Bookings:** rounded 12px cards, filled with their treatment's light tint and bordered 1.5px in its colour, above the now line. The start time leads in Diary-time type; the end time beside it is dropped, never cut mid-number, when the card is narrow. A booking made by the receptionist and not yet seen has a 2px border and a NEW chip.
- **Status, in words** (the same in Day and Week): a finished booking takes a "Done" chip and a quieter Sage Ground fill; a no-show a red "No-show" chip and a dashed edge. Never opacity, which takes the text below 4.5:1. Each booking's accessible name carries its technician and status.
- **Double bookings:** two bookings at once for one person cascade (the later one on top, inset 14px) rather than splitting the lane, so both keep their start time, name and status; each takes a 2px red border and a "Double-booked" chip, and the lane's header (a red dot on the phone's tab) says so too.
- **Cancelled bookings** hold no time: a one-line pill at the start time ("4:30 Evie Clarke · Cancelled", name struck through) that opens it; the time around it books like any free time.
- **Time:** hours large and bold in the gutter, half hours small; the current time is a Now Orange line with a pill on the clock.
- **Free time:** "1 h free" labels in Sage Deep under each gap.

## Do's and Don'ts

### Do:
- **Do** take colours from the tokens in `src/app/globals.css`; a new value goes there first.
- **Do** keep times, prices and counts tabular.
- **Do** give every control a hover, focus, pressed and disabled state, and 44px targets on phones.
- **Do** check every new string in Vietnamese, which runs longer.

### Don't:
- **Don't** put a coloured stripe down one side of a card, alert or booking.
- **Don't** use bronze for anything but "waiting", or a treatment hue outside the diary.
- **Don't** use a shadow heavier than Raised, or a grey or black one.
- **Don't** bring the salon pages' fonts, cream or salon colour into the staff app, or the sage into a salon's pages.

## The salon's own pages (the second world)

The client-facing pages (`src/components/online-booking/`) belong to the salon, not to Kikai. Their look is a poster: the salon's own colour (`--brand`, with `--brand-fg` and `--brand-ink` worked out for contrast) as the hero ground, cream (salon-cream) between sections, ink (salon-ink) for text, big narrow capitals in Bricolage Grotesque (salon-display) over Instrument Sans (salon-text), nail-tip arches around photos, and an accent for stickers that turns cream when the salon's colour is warm (`accentFor`).

- **Buttons** are full pills, 52px tall on the page; every control presses in under a finger and dims instead with reduced motion (`salon.module.css`), with one focus ring in `--ring`, light on the salon's colour and on ink.
- **Photos** are shared stock, captioned as examples, never presented as the salon's work.
- **Kikai** appears only as "Online booking by Kikai".
