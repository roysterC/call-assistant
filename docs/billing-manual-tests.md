# Billing: manual tests

Checks to run by hand before charging real salons (README: "Plans and
billing"). Use Stripe **test mode** throughout: no real money moves.

## Setup

1. Put test keys where you are testing: `STRIPE_SECRET_KEY=sk_test_…` and
   `STRIPE_WEBHOOK_SECRET=whsec_…`. Locally, run
   `stripe listen --forward-to localhost:3000/api/stripe/webhook` and use
   the `whsec_…` it prints.
2. Admin → Prices: give each AI tool a price (for example £15 chat replies,
   £10 booking by message).
3. Create a test salon in Admin with your own email as owner, **Not billed**
   left unticked.

Test cards (any future expiry, any CVC):

| Card | Behaves |
| --- | --- |
| `4242 4242 4242 4242` | Always works |
| `4000 0000 0000 0341` | Accepted, but every payment fails |
| `4000 0025 0000 3155` | Asks for the bank's security check |

## A. Making a tester free

- [ ] Salon with no card: **Make free (not billed)** → shows Not billed; the
      owner's Plan & billing says "Not billed".
- [ ] Salon with a card (after C): Make free → in Stripe the subscription is
      cancelled and nothing new is charged; the salon shows Not billed; its
      old invoices are still listed.
- [ ] On that salon, switch an AI tool on under Features → it works without
      being on the plan.
- [ ] After the nightly check (or H by hand) → still Not billed.

## B. Trial with no card

- [ ] Accept the owner invite → Plan & billing shows 14 days left; Admin the
      same.
- [ ] AI tools show **Add** greyed out with "Add a card first".
- [ ] Trial down to 2 days (locally, set `trialEndsAt` in the database) →
      orange banner on every page.
- [ ] Trial end in the past → red "paused" banner, and:
  - [ ] New booking refused; moving a booking refused.
  - [ ] The salon's website still takes online bookings.
  - [ ] Adding a client and blocking out time still work.
  - [ ] Inviting a login and saving settings refused.
  - [ ] Checking out, cancelling and notes still work.
  - [ ] As a Kikai super-admin, everything still works.

## C. Adding a card

- [ ] Owner presses **Add a card** → Stripe's page → pay with `4242…` → back
      on Plan & billing with "Card added".
- [ ] In Stripe: the subscription is on trial, first charge on the trial's
      end date; lines are the plan plus extra team members.
- [ ] Admin shows "Card on file".
- [ ] Add a card again in a second tab and finish both → Stripe cancels the
      second subscription by itself; only one stays.

## C2. Cancelling

- [ ] Owner presses **Cancel my plan** → confirms → the page says "Your plan
      ends on …" (the end of the paid month, or the trial); in Stripe the
      subscription is set to cancel at period end.
- [ ] **Keep my plan** → back as before; Stripe no longer set to cancel.
- [ ] Cancel again, then end the period early in Stripe (Stripe test clock,
      or cancel now in Stripe) → the salon is paused; its bookings and
      website still work; **Add a card** starts a new subscription.

## D. Team size

- [ ] Add a team member with no login → Stripe's extra-member quantity goes
      up by 1 within seconds.
- [ ] Invite a login and accept it → up again; remove them → down.

## E. AI tools

- [ ] Add **Booking by message** → asks to add **AI chat replies** too;
      confirm → both appear in Stripe.
- [ ] Remove chat replies → booking by message goes too.
- [ ] **Ask us to set it up** on the receptionist → you get an email; Admin
      shows the request.

## F. Failed payment

- [ ] In Stripe, change the salon's card to `…0341` and end the trial early →
      "payment didn't go through" banner; Admin shows the invoice in red as
      owed, with its failed tries.
- [ ] **Update card** to `4242…`, then **Try again** → banner gone; invoice
      shows Paid.
- [ ] Let the retries run out (or mark the invoice uncollectible in Stripe)
      → salon paused as in B; paying unpauses it at once.

## G. Notice log

- [ ] Stop the app briefly while Stripe sends a notice, then start it →
      Stripe retries, and the salon's notice list ends on "done".
- [ ] Resend a notice from Stripe's dashboard → nothing changes twice.

## H. Nightly check

- [ ] Run it by hand on the server:

  ```bash
  curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
    http://127.0.0.1:3000/api/cron/billing-reconcile
  ```

  It lists the salons checked, nothing fixed.
- [ ] Change a subscription's extra-member quantity by hand in Stripe, run it
      again → put back, and an email says what was fixed.

## H2. Trial emails and wiping paused salons

- [ ] A trial with no card ending in 3 days: after the next timer run, the
      owner has "Your Kikai free trial ends in 3 days"; the day before it
      ends (by the London date), "ends tomorrow". Each comes once.
- [ ] `/api/cron/purge-paused?dryRun=1` names the candidates, and who the
      next run would warn and delete, and changes nothing.
- [ ] With `PURGE_WHEN_DB_OVER_GB` set low, a paused salon idle 90+ days:
      first run emails its owner; signing in clears it; 14 days after a
      warning, the next run deletes it and emails Kikai.

## I. Existing salons

- [ ] Every salon from before billing shows **Not billed**, with everything
      still working and no banner.
