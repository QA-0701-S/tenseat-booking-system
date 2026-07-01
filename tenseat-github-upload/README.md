# TenSeat Booking System

TenSeat is a multi-restaurant booking system with Stripe subscription billing for A$10/month Basic and A$20/month Pro plans.

## Local Start

```bash
npm install
npm start
```

- Restaurant A guest booking page: `http://127.0.0.1:8795/r/restaurant-a`
- TenSeat official homepage: `http://127.0.0.1:8795/`
- Restaurant login and registration: `http://127.0.0.1:8795/owner`

## Demo Restaurant Account

- Email: `restaurant.a@example.com`
- Temporary password: `RestaurantA123`

The dashboard warns the owner to change this default password. Before real use, replace it with a password only the restaurant knows.

## Current Features

- Each restaurant can register, log in, and get its own booking link.
- The root homepage introduces TenSeat and links restaurants to the dashboard login.
- Public Terms and Privacy Policy pages are available from the homepage footer and registration flow.
- New restaurant registration requires agreement to the Terms and Privacy Policy.
- Guests choose date, last name, first name, required phone number, party size, notes, and a 24-hour time inside the restaurant service periods.
- Restaurants can set one or two service periods, such as lunch `11:30-14:30` and dinner `17:00-21:00`.
- Each restaurant booking page updates the Google Maps embed from the dashboard address or Google Maps search text.
- Maximum party size is configurable. Restaurant A defaults to 20 guests.
- Capacity at the same exact time is configurable, and the system blocks overbooking.
- Guests receive an on-screen booking code and are prompted to copy it.
- If Gmail SMTP is configured and the guest enters an email address, TenSeat sends a booking confirmation email.
- Guests can cancel by booking code.
- The restaurant dashboard shows bookings, guest count, phone number, email, notes, cancelled bookings, no-shows, and booking codes.
- Restaurant staff can add manual phone or walk-in bookings.
- Restaurant staff can cancel bookings, mark no-shows, and restore bookings.
- Stripe Checkout supports Basic and Pro monthly subscriptions from the restaurant dashboard.
- Stripe webhooks update restaurant subscription status after checkout, updates, and cancellations.
- Stripe Billing Portal lets subscribed restaurants manage payment methods, invoices, and cancellation.
- New restaurants receive a 14-day trial.
- Restaurants that register with an active paid restaurant referral code receive a 30-day trial.
- Paid restaurants get their own repeatable referral code and can earn up to 12 months of referral credits.
- The seeded Chirin account is a permanent free account for internal/founding use.
- Expired trials and cancelled, unpaid, past-due, or incomplete subscriptions pause new bookings without deleting existing bookings.
- Booking codes use a short format such as `TS-8K42PA`.
- Passwords are salted and hashed.
- Basic rate limits are enabled for login, registration, booking, and cancellation endpoints.
- Server startup creates backups of `data/restaurants.json` and `data/bookings.json`.
- Cloud environment variables are supported: `HOST`, `PORT`, `PUBLIC_ORIGIN`, `SESSION_SECRET`, `TRUST_PROXY`, `DATA_DIR`.

## Security Notes

- Guest phone numbers are only returned to authenticated restaurant dashboard APIs. Public booking and cancellation responses do not expose phone numbers or internal booking IDs.
- Keep `SESSION_SECRET` private and at least 32 characters long.
- Use HTTPS in production and set `PUBLIC_ORIGIN` to the real website URL.
- Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` private. Never commit live Stripe keys.
- JSON file storage is acceptable for an MVP, but a paid multi-customer version should move to Postgres, Supabase, or another managed database with backups and persistent storage.
- The included Privacy Policy and Terms are product-ready templates, but should be reviewed for the final business entity before charging restaurants.

## Deployment

The project includes:

- `.env.example`: environment variable template
- `render.yaml`: Render Web Service template
- `.gitignore`: excludes local secrets, backups, and dependencies

Recommended production environment:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=10000
PUBLIC_ORIGIN=https://your-tenseat-domain.example
SESSION_SECRET=replace-with-a-random-secret-of-at-least-32-characters
TRUST_PROXY=true
DATA_DIR=/var/data/tenseat
TRIAL_DAYS=14
REFERRAL_TRIAL_DAYS=30
MAX_REFERRAL_CREDITS=12
GMAIL_USER=your-gmail-address@gmail.com
GMAIL_APP_PASSWORD=your-16-character-google-app-password
EMAIL_FROM_NAME=TenSeat
STRIPE_SECRET_KEY=sk_test_or_live_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_BASIC_PRICE_ID=price_basic_monthly_optional
STRIPE_PRO_PRICE_ID=price_pro_monthly_optional
```

Gmail sending requires a Google App Password. A normal Gmail login password should not be used. Spaces in the App Password are removed automatically.

`STRIPE_BASIC_PRICE_ID` and `STRIPE_PRO_PRICE_ID` are optional. If they are empty, the app creates Checkout Sessions with inline A$10/month and A$20/month prices. For a cleaner production Stripe dashboard, create recurring monthly Price IDs in Stripe and add them here.

## Stripe Setup

1. Create or log in to a Stripe account.
2. Use test mode first.
3. Add `STRIPE_SECRET_KEY` in Render.
4. In Stripe, create a webhook endpoint for `https://your-domain.com/api/stripe/webhook`.
5. Subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.paid`.
6. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET` in Render.
7. Optional: create monthly recurring prices for Basic A$10 and Pro A$20, then add their Price IDs to Render.
8. Redeploy the Render service and test Billing from `/owner`.

## Referral Program

- Normal registration: 14 days free, then A$10/month Basic or A$20/month Pro.
- Referral code registration: 30 days free, then the selected monthly plan.
- Each paid restaurant has one referral code that can be shared with multiple new restaurants.
- A new restaurant can use one referral code during account registration only.
- After the referred restaurant completes its first paid month, the referring restaurant receives 1 month of credit.
- Referral credits are capped at 12 months per restaurant.
- Referral rewards cannot be withdrawn as cash or transferred to another restaurant.

## Render Steps

1. Upload this project to GitHub.
2. Create a Render Web Service and connect the GitHub repository.
3. If Render detects `render.yaml`, create the service from that blueprint.
4. Set `PUBLIC_ORIGIN` to the final site URL.
5. Use a persistent disk if you want JSON data to survive redeploys. Mount it at `/var/data/tenseat`.
6. Test `/r/restaurant-a` for guest bookings and `/owner` for the restaurant dashboard.
7. Change the starter password, then add the restaurant booking link to Google Business Profile.

## Test Data

The seed script creates two test restaurants:

- `http://127.0.0.1:8795/r/restaurant-a`: two service periods, sample Restaurant A profile.
- `http://127.0.0.1:8795/r/split-shift-bistro`: two service periods, map location Adelaide Central Market.

Test dashboard accounts:

- `restaurant.a@example.com` / `RestaurantA123`
- `chirin.food191@gmail.com` / `Chirin1919!` (permanent free account)
- `split.bistro@example.com` / `SplitBistro123`

Create local test data:

```bash
npm run seed:test
```

Create test data on a deployed Render site:

```bash
BASE_URL=https://tenseat-booking-system.onrender.com npm run seed:test
```
