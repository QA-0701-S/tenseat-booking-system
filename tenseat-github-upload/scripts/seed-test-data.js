"use strict";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:8795").replace(/\/$/, "");
const BOOKING_DATE = process.env.TEST_BOOKING_DATE || tomorrowDate();

const fixtures = [
  {
    slug: "restaurant-a",
    name: "Restaurant A",
    email: "restaurant.a@example.com",
    password: "RestaurantA123",
    address: "123 Sample Street, Adelaide SA",
    googleMapsQuery: "Adelaide Central Market Adelaide",
    maxPartySize: 20,
    timeSlotCapacity: 30,
    servicePeriods: [
      { openingTime: "11:30", closingTime: "14:30" },
      { openingTime: "17:00", closingTime: "21:00" }
    ],
    bookings: [
      { firstName: "Ava", lastName: "Brown", phone: "0400 111 222", email: "ava@example.com", time: "12:10", partySize: 2, notes: "Window seat" },
      { firstName: "Noah", lastName: "Wilson", phone: "0400 333 444", email: "noah@example.com", time: "18:45", partySize: 4, notes: "Birthday" }
    ]
  },
  {
    slug: "split-shift-bistro",
    name: "Split Shift Bistro",
    email: "split.bistro@example.com",
    password: "SplitBistro123",
    address: "Adelaide Central Market, Adelaide SA",
    googleMapsQuery: "Adelaide Central Market Adelaide",
    maxPartySize: 12,
    timeSlotCapacity: 24,
    servicePeriods: [
      { openingTime: "11:30", closingTime: "14:30" },
      { openingTime: "17:00", closingTime: "21:00" }
    ],
    bookings: [
      { firstName: "Mia", lastName: "Brown", phone: "0400 555 666", email: "mia@example.com", time: "12:30", partySize: 3, notes: "High chair" },
      { firstName: "Jack", lastName: "Wilson", phone: "0400 777 888", email: "jack@example.com", time: "18:45", partySize: 5, notes: "Peanut allergy" },
      { firstName: "Olivia", lastName: "Taylor", phone: "0400 999 000", email: "olivia@example.com", time: "20:00", partySize: 2, notes: "Cancelled test", cancel: true }
    ]
  }
];

async function main() {
  for (const fixture of fixtures) {
    const session = await upsertRestaurant(fixture);
    await seedBookings(fixture, session.token);
  }
  console.log(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    bookingDate: BOOKING_DATE,
    restaurants: fixtures.map(function (fixture) {
      return BASE_URL + "/r/" + fixture.slug;
    })
  }, null, 2));
}

async function upsertRestaurant(fixture) {
  let session;
  try {
    session = await json("/api/owner/register", {
      method: "POST",
      body: JSON.stringify({
        name: fixture.name,
        email: fixture.email,
        password: fixture.password,
        address: fixture.address,
        googleMapsQuery: fixture.googleMapsQuery,
        maxPartySize: fixture.maxPartySize,
        timeSlotCapacity: fixture.timeSlotCapacity,
        servicePeriods: fixture.servicePeriods,
        termsAccepted: true
      })
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    session = await json("/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ email: fixture.email, password: fixture.password })
    });
  }

  await json("/api/owner/me", {
    method: "PATCH",
    token: session.token,
    body: JSON.stringify({
      name: fixture.name,
      address: fixture.address,
      googleMapsQuery: fixture.googleMapsQuery,
      maxPartySize: fixture.maxPartySize,
      timeSlotCapacity: fixture.timeSlotCapacity,
      servicePeriods: fixture.servicePeriods
    })
  });
  if (session.restaurant && session.restaurant.approvalStatus === "pending") {
    await approveRestaurant(session.restaurant.id);
  }
  return session;
}

async function approveRestaurant(restaurantId) {
  const password = process.env.PLATFORM_ADMIN_PASSWORD || process.env.TENSEAT_ADMIN_PASSWORD || "";
  if (!password) {
    throw new Error("Set PLATFORM_ADMIN_PASSWORD before seeding new restaurants, because new accounts require TenSeat approval.");
  }
  const platform = await json("/api/platform/login", {
    method: "POST",
    body: JSON.stringify({ password: password })
  });
  await json("/api/platform/restaurants/" + encodeURIComponent(restaurantId), {
    method: "PATCH",
    token: platform.token,
    body: JSON.stringify({ action: "approve" })
  });
}

async function seedBookings(fixture, token) {
  const current = await json("/api/owner/bookings?date=" + encodeURIComponent(BOOKING_DATE), {
    method: "GET",
    token: token
  });

  for (const booking of fixture.bookings) {
    const existing = current.bookings.find(function (item) {
      return item.lastName === booking.lastName &&
        item.firstName === booking.firstName &&
        item.time === booking.time;
    });
    if (existing) continue;

    const created = await json("/api/restaurants/" + fixture.slug + "/bookings", {
      method: "POST",
      body: JSON.stringify({
        date: BOOKING_DATE,
        firstName: booking.firstName,
        lastName: booking.lastName,
        phone: booking.phone,
        email: booking.email,
        partySize: booking.partySize,
        time: booking.time,
        notes: booking.notes || ""
      })
    });

    if (booking.cancel) {
      await json("/api/restaurants/" + fixture.slug + "/cancel", {
        method: "POST",
        body: JSON.stringify({ code: created.booking.code })
      });
    }
  }
}

async function json(path, options) {
  const headers = { "Content-Type": "application/json" };
  if (options && options.token) headers.Authorization = "Bearer " + options.token;
  const response = await fetch(BASE_URL + path, { ...options, headers: headers });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const error = new Error(result.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return result;
}

function tomorrowDate() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

main().catch(function (error) {
  console.error(error.message);
  process.exit(1);
});
