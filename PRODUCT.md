# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Owners and staff of nail salons in the UK. The product is for nail salons specifically; the code can describe hair and beauty businesses (`src/lib/business-types.ts`), but that support is incidental, not a target market.

A second audience is each salon's own clients, who meet the product only through the salon: its public page and booking flow (`/s/<slug>`, `book.getkikai.com`, `<slug>.getkikai.com`, the embed in a salon's existing site), its phone line and its WhatsApp, Instagram and Facebook messages.

## Product Purpose

Kikai is the salon's whole front desk in one place, so a small nail salon can take and manage bookings without a receptionist and without a marketplace taking commission. Success is a salon whose calls, messages and online bookings all land in one diary, with nothing missed and no double bookings.

## Positioning

An all-in-one front desk owned by the salon, not a marketplace. Calls, chats, the diary, reminder and rebooking texts and the salon's own website live together, and clients book with the salon under the salon's name, without commission. Fresha, Booksy and Treatwell put the salon inside their own marketplace brand; Kikai keeps itself in the background.

## Operating Context

- **Phone receptionist:** an AI answers the salon's own number, quotes services, checks the diary and books. Design quotes are passed to the salon's Instagram or WhatsApp, where photos can be sent.
- **Chat assistant:** WhatsApp, Instagram and Facebook messages are answered and booked the same way, and design photos are attached to the booking.
- **Staff side:** a diary of who is working, appointments, callbacks, clients, conversations, insights and settings, with push notifications for new callbacks and messages. Staff can use it in English or Vietnamese.
- **Client side:** a one-page site per salon, built from its settings (name, headline, about, treatments and prices, team, hours, address, phone, brand colour), and a booking flow that asks only for service, time, name and mobile. Clients pay at the salon.
- **Texts:** booking confirmations, reminders and rebooking nudges, sent under the salon's own sender name.
- **Billing:** salons subscribe through Stripe; plans can be paused or made free by an admin.

## Capabilities and Constraints

- **Stack:** Next.js 16, React 19, Prisma 7 on PostgreSQL, Tailwind 4 with shadcn/ui; production on netcup behind Caddy at app.getkikai.com (see README.md).
- **Languages:** English and Vietnamese are both required. Many nail salons are Vietnamese-run, so staff-facing work must hold up in Vietnamese: longer strings, diacritics in every typeface. Copy stays plain and short in both languages.
- **Client-facing language:** UK English.
- **Undecided:** which devices staff mostly use (phone between clients versus a desk or tablet) has not been confirmed; check before designing around one.

## Brand Commitments

- **The salon's brand leads on client-facing pages.** The public site, booking flow and texts carry the salon's name and colour. Kikai appears only as a quiet credit ("Online booking by Kikai").
- **No fabricated proof, anywhere.** No invented testimonials, reviews, salon names, statistics, or photos presented as a salon's own work. Shared stock photos must be labelled as examples, as the salon page already does ("Example photos, not our own work").

## Evidence on Hand

- Licensed stock nail photos (Unsplash licence), shared by every salon page: `src/components/online-booking/photos/`, listed in `photos.ts`. They are not any salon's work.
- Each salon's own settings are the only source of its content.
- There are no testimonials, case studies, customer logos, press or usage figures in the repository. Future work must not invent them.

## Product Principles

1. **The salon is the brand.** Kikai serves the salon in front of its clients and never competes with it for attention.
2. **One front desk, one diary.** Calls, chats and online bookings arrive in the same place and obey the same booking rules; no channel gets its own version of the truth.
3. **Ask as little as possible.** Clients book in a few taps, and staff act in a few steps. Anything the system already knows is never asked for again.
4. **Never pretend.** Show only real content: no fabricated proof, no invented availability, no claims the salon didn't make.
5. **Works in both languages.** A screen isn't finished until it reads well in Vietnamese as well as English.
