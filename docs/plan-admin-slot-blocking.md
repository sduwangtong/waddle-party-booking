# Plan: Admin slot blocking in the UI

## Why
Blocking a slot today means hand-inserting 3 fake `paid` records into DynamoDB
(done for 2026-08-02 "5:30 – 7:30 PM", items `block-2026-08-02-530pm-1..3`).
That works but is error-prone (exact en-dash slot string, capacity count) and
requires AWS CLI access. Goal: block/unblock any date+slot from a simple web page.

> Note: this repo is the OLD frontend (redirect page). The live site is the
> `waddle-party-booking-live` repo (GitHub Pages) → API `ew68um0lpa` →
> CloudFormation stack `waddle-booking-live`, table `waddle-booking-live-bookings`.
> Backend changes below go into this repo's `backend/` (it is the deployed stack);
> the admin page goes into the live frontend repo.

## Design

### 1. Data model — first-class `blocked` status (1 item per block)
One item per blocked slot instead of 3 fake paid bookings:

```
bookingId: block-<dateISO>-<slot-key>     e.g. block-2026-08-09-530pm
dateISO:   2026-08-09
time:      "5:30 – 7:30 PM"               (exact slot string)
status:    "blocked"
reason:    "private party"                (free text, shown in admin UI only)
createdAt: ISO timestamp
```

`shared/capacity.mjs` change: in `bookedCounts()`, any item with
`status === 'blocked'` sets that slot's count to `CAPACITY` (full), regardless
of other bookings. `isActiveHold` unchanged. Unblock = delete the one item.

### 2. Backend — one small Admin Lambda
New Lambda `Admin` with three routes (added to `template.yaml`):

- `GET  /admin/blocks?date=YYYY-MM-DD` → list blocks + booked counts for the date
- `POST /admin/block`   `{date, time, reason}` → put block item
- `POST /admin/unblock` `{date, time}` → delete block item

Auth: shared secret in header `x-admin-token`, compared to `ADMIN_TOKEN`
env var (a CloudFormation parameter, same pattern as the Stripe keys).
Good enough for a single-owner venue; no user accounts needed.

### 3. Frontend — `admin.html` in the live repo
Self-contained page (same no-build style as `index.html`):

- Token prompt on first visit, saved to `localStorage`.
- Date picker → shows that date's slots with booked count (`n/3`) and a
  **Block / Unblock** toggle per slot, plus a "Block whole day" button
  (loops all slots).
- Deployed on GitHub Pages next to the booking page; obscurity + token header
  is the access control (the API rejects without the token).

### 4. Migration / cleanup
- Replace the 3 manual `block-2026-08-02-530pm-*` paid items with one
  `blocked` item once the capacity change is deployed (or leave them —
  both keep the slot full; cleanup is cosmetic).

## Order of work
1. `capacity.mjs` blocked-status logic + unit test (`functions/test/`)
2. Admin Lambda + routes + `ADMIN_TOKEN` param in `template.yaml`; `sam deploy`
3. `admin.html` in the live frontend repo; test block/unblock round-trip
4. Swap the 8/2 manual records for one blocked item

Estimated size: ~1 short session. No changes to the customer booking flow
besides slots showing "Fully booked" (already-existing behavior).

## Rejected alternatives
- **Admin page writes 3 fake paid bookings** (no backend change): keeps the
  hack, pollutes booking data, unblock is fiddly.
- **Square/Google Calendar integration**: overkill for one venue with 4 slots.
