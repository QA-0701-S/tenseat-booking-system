# TenSeat Booking System

TenSeat is a multi-restaurant booking system. The planned subscription price is A$10/month. Real Stripe billing is not connected yet.

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
- Guests choose date, last name, first name, required phone number, party size, notes, and a 24-hour time inside the restaurant service periods.
- Restaurants can set one or two service periods, such as lunch `11:30-14:30` and dinner `17:00-21:00`.
- Each restaurant booking page updates the Google Maps embed from the dashboard address or Google Maps search text.
- Maximum party size is configurable. Restaurant A defaults to 20 guests.
- Capacity at the same exact time is configurable, and the system blocks overbooking.
- Guests receive an on-screen booking code and are prompted to copy it.
- Guests can cancel by booking code.
- The restaurant dashboard shows bookings, guest count, phone number, notes, cancelled bookings, no-shows, and booking codes.
- Restaurant staff can add manual phone or walk-in bookings.
- Restaurant staff can cancel bookings, mark no-shows, and restore bookings.
- Booking codes use a short format such as `TS-8K42PA`.
- Passwords are salted and hashed.
- Basic rate limits are enabled for login, registration, booking, and cancellation endpoints.
- Server startup creates backups of `data/restaurants.json` and `data/bookings.json`.
- Cloud environment variables are supported: `HOST`, `PORT`, `PUBLIC_ORIGIN`, `SESSION_SECRET`, `TRUST_PROXY`, `DATA_DIR`.

## Security Notes

- Guest phone numbers are only returned to authenticated restaurant dashboard APIs. Public booking and cancellation responses do not expose phone numbers or internal booking IDs.
- Keep `SESSION_SECRET` private and at least 32 characters long.
- Use HTTPS in production and set `PUBLIC_ORIGIN` to the real website URL.
- JSON file storage is acceptable for an MVP, but a paid multi-customer version should move to Postgres, Supabase, or another managed database with backups and persistent storage.
- Add Privacy Policy, Terms, and subscription/cancellation terms before charging restaurants.

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
```

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
- `split.bistro@example.com` / `SplitBistro123`

Create local test data:

```bash
npm run seed:test
```

Create test data on a deployed Render site:

```bash
BASE_URL=https://tenseat-booking-system.onrender.com npm run seed:test
```
