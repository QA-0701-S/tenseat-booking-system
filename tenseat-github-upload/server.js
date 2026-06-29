"use strict";

const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const APP_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(APP_DIR, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
const RESTAURANTS_FILE = path.join(DATA_DIR, "restaurants.json");
const SECRET_FILE = path.join(DATA_DIR, ".session-secret");
const PORT = Number(process.env.PORT || 8795);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ""));
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const RATE_LIMITS = new Map();
const RATE_LIMIT_RULES = {
  api: { windowMs: 60 * 1000, max: 160 },
  auth: { windowMs: 10 * 60 * 1000, max: 12 },
  booking: { windowMs: 10 * 60 * 1000, max: 45 },
  cancel: { windowMs: 10 * 60 * 1000, max: 25 }
};
const PUBLIC_FILES = new Map([
  ["/", ["home.html", "text/html; charset=utf-8"]],
  ["/home.html", ["home.html", "text/html; charset=utf-8"]],
  ["/home.css", ["home.css", "text/css; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/owner", ["admin.html", "text/html; charset=utf-8"]],
  ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
  ["/admin.css", ["admin.css", "text/css; charset=utf-8"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]]
]);

let dataWriteQueue = Promise.resolve();
let sessionSecret = "";
let emailTransporter = null;
let emailTransporterKey = "";

function sendJson(response, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...(extraHeaders || {})
  });
  response.end(body);
}

function isLocalOrigin(origin) {
  return origin === "null" || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

function applySecurityHeaders(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Vary", "Origin");

  const origin = String(request.headers.origin || "");
  if (!origin) return;
  if ((PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) || isLocalOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
}

function clientAddress(request) {
  if (TRUST_PROXY) {
    const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwardedFor) return forwardedFor;
    const realIp = String(request.headers["x-real-ip"] || "").trim();
    if (realIp) return realIp;
  }
  return request.socket.remoteAddress || "unknown";
}

function rateLimitKey(request, bucket) {
  return bucket + ":" + clientAddress(request);
}

function takeRateLimit(request, bucket, rule) {
  const now = Date.now();
  const key = rateLimitKey(request, bucket);
  let entry = RATE_LIMITS.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + rule.windowMs };
  }
  entry.count += 1;
  RATE_LIMITS.set(key, entry);
  return {
    ok: entry.count <= rule.max,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}

function enforceRateLimit(request, response, bucket, rule) {
  const result = takeRateLimit(request, bucket, rule);
  if (result.ok) return false;
  sendJson(response, 429, {
    ok: false,
    error: "Too many requests. Please try again later."
  }, { "Retry-After": String(result.retryAfter) });
  return true;
}

function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, entry] of RATE_LIMITS.entries()) {
    if (entry.resetAt <= now) RATE_LIMITS.delete(key);
  }
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function isValidBookingDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00");
  return !Number.isNaN(date.getTime()) && localDateString(date) === value;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(time) {
  const parts = time.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function cleanServicePeriod(input) {
  return {
    openingTime: String((input && (input.openingTime || input.start)) || "").trim(),
    closingTime: String((input && (input.closingTime || input.end)) || "").trim()
  };
}

function servicePeriodsFromInput(input, useDefaults) {
  let rawPeriods = Array.isArray(input.servicePeriods) ? input.servicePeriods.slice(0, 2) : null;
  if (!rawPeriods) {
    rawPeriods = [{
      openingTime: input.openingTime || (useDefaults ? "11:30" : ""),
      closingTime: input.closingTime || (useDefaults ? "14:30" : "")
    }];
  }
  return rawPeriods
    .map(cleanServicePeriod)
    .filter(function (period) { return period.openingTime || period.closingTime; })
    .sort(function (left, right) { return timeToMinutes(left.openingTime || "00:00") - timeToMinutes(right.openingTime || "00:00"); });
}

function servicePeriodsFor(restaurant) {
  const periods = servicePeriodsFromInput({
    servicePeriods: restaurant.servicePeriods,
    openingTime: restaurant.openingTime,
    closingTime: restaurant.closingTime
  }, true);
  return periods.length ? periods : [{ openingTime: "11:30", closingTime: "14:30" }];
}

function validateServicePeriods(periods) {
  if (!periods.length) return "Add at least one service period.";
  if (periods.length > 2) return "Only two service periods are supported.";
  for (const period of periods) {
    if (!isValidTime(period.openingTime) || !isValidTime(period.closingTime)) {
      return "Enter complete, valid service hours.";
    }
    if (timeToMinutes(period.openingTime) >= timeToMinutes(period.closingTime)) {
      return "Each service period must close after it opens.";
    }
  }
  if (periods.length === 2 && timeToMinutes(periods[0].closingTime) > timeToMinutes(periods[1].openingTime)) {
    return "Service periods cannot overlap.";
  }
  return "";
}

function formatServicePeriods(periods) {
  return periods.map(function (period) {
    return period.openingTime + "-" + period.closingTime;
  }).join(" / ");
}

function isTimeInServicePeriods(time, periods) {
  const value = timeToMinutes(time);
  return periods.some(function (period) {
    return value >= timeToMinutes(period.openingTime) && value <= timeToMinutes(period.closingTime);
  });
}

function normalizeNotes(value) {
  return String(value || "").trim().slice(0, 300);
}

function normalizeGuestText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePhone(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeGuestEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

function personFromInput(input) {
  const firstName = normalizeGuestText(input.firstName);
  const lastName = normalizeGuestText(input.lastName);
  const legacyName = normalizeGuestText(input.name);
  return {
    firstName: firstName,
    lastName: lastName,
    legacyName: legacyName,
    displayName: firstName && lastName ? firstName + " " + lastName : legacyName
  };
}

function bookingDisplayName(booking) {
  const firstName = normalizeGuestText(booking.firstName);
  const lastName = normalizeGuestText(booking.lastName);
  if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(" ");
  return normalizeGuestText(booking.name);
}

function activeBooking(booking) {
  return booking.status !== "cancelled" && booking.status !== "no_show";
}

function makeBookingCode(bookings) {
  const existing = new Set(bookings.map(function (booking) {
    return String(booking.code || "").toUpperCase();
  }));
  let code = "";
  do {
    code = "TS-" + crypto.randomBytes(4).toString("base64url").replace(/[_-]/g, "").slice(0, 6).toUpperCase();
  } while (existing.has(code) || !/^TS-[A-Z0-9]{6}$/.test(code));
  return code;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function makeSlug(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "restaurant";
}

function publicRestaurant(restaurant) {
  const servicePeriods = servicePeriodsFor(restaurant);
  return {
    slug: restaurant.slug,
    name: restaurant.name,
    address: restaurant.address,
    googleMapsQuery: restaurant.googleMapsQuery,
    openingTime: servicePeriods[0].openingTime,
    closingTime: servicePeriods[servicePeriods.length - 1].closingTime,
    servicePeriods: servicePeriods,
    maxPartySize: restaurant.maxPartySize
  };
}

function ownerRestaurant(restaurant) {
  return {
    ...publicRestaurant(restaurant),
    id: restaurant.id,
    plan: restaurant.plan,
    priceMonthly: restaurant.priceMonthly,
    currency: restaurant.currency,
    subscriptionStatus: restaurant.subscriptionStatus,
    timeSlotCapacity: restaurant.timeSlotCapacity || Math.max(restaurant.maxPartySize || 1, 20),
    trialEndsAt: restaurant.trialEndsAt,
    mustChangePassword: Boolean(restaurant.mustChangePassword)
  };
}

async function readArray(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function writeArray(file, value) {
  const temporary = file + "." + process.pid + "." + Date.now() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temporary, file);
}

async function createStartupBackup() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const file of [RESTAURANTS_FILE, BOOKINGS_FILE]) {
    if (await fileExists(file)) {
      const parsed = path.parse(file);
      await fs.copyFile(file, path.join(BACKUP_DIR, parsed.name + "-" + timestamp + parsed.ext));
    }
  }
  await pruneBackups();
}

async function pruneBackups() {
  let entries = [];
  try {
    entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fullPath = path.join(BACKUP_DIR, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
  }
  files.sort(function (left, right) { return right.mtimeMs - left.mtimeMs; });
  await Promise.all(files.slice(40).map(function (file) { return fs.rm(file.path, { force: true }); }));
}

function scrypt(password, salt) {
  return new Promise(function (resolve, reject) {
    crypto.scrypt(password, salt, 64, function (error, derivedKey) {
      if (error) reject(error);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

async function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { passwordSalt: salt, passwordHash: await scrypt(password, salt) };
}

async function passwordMatches(password, restaurant) {
  if (!restaurant.passwordSalt || !restaurant.passwordHash) return false;
  const actual = Buffer.from(await scrypt(password, restaurant.passwordSalt), "hex");
  const expected = Buffer.from(restaurant.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validatePassword(password) {
  const value = String(password || "");
  const lower = value.toLowerCase();
  const weakPasswords = new Set(["1919", "password", "password1", "12345678", "123456789", "qwerty123"]);
  if (value.length < 8) return "Password must be at least 8 characters.";
  if (weakPasswords.has(lower)) return "This password is too easy to guess. Choose a stronger password.";
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) return "Password must include both letters and numbers.";
  return "";
}

function issueToken(restaurantId) {
  const payload = Buffer.from(JSON.stringify({
    restaurantId: restaurantId,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: crypto.randomBytes(8).toString("hex")
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return payload + "." + signature;
}

function readToken(request) {
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", sessionSecret).update(parts[0]).digest();
  let supplied;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload.restaurantId || payload.expiresAt < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function authenticatedRestaurant(request) {
  const token = readToken(request);
  if (!token) return null;
  const restaurants = await readArray(RESTAURANTS_FILE);
  return restaurants.find(function (restaurant) { return restaurant.id === token.restaurantId; }) || null;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function parseBody(request, response) {
  try {
    return await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error.message });
    return null;
  }
}

function validateRestaurantSettings(input) {
  const name = String(input.name || "").trim();
  const servicePeriods = servicePeriodsFromInput(input, false);
  const maxPartySize = Number(input.maxPartySize);
  const timeSlotCapacity = Number(input.timeSlotCapacity || input.maxGuestsPerTime || maxPartySize);
  if (!name || name.length > 80) return "Enter a valid restaurant name.";
  const servicePeriodsError = validateServicePeriods(servicePeriods);
  if (servicePeriodsError) return servicePeriodsError;
  if (!Number.isInteger(maxPartySize) || maxPartySize < 1 || maxPartySize > 100) {
    return "Maximum party size must be between 1 and 100.";
  }
  if (!Number.isInteger(timeSlotCapacity) || timeSlotCapacity < maxPartySize || timeSlotCapacity > 500) {
    return "Capacity at the same time must be at least the maximum party size and no more than 500.";
  }
  return "";
}

function validateBooking(input, restaurant) {
  const date = String(input.date || "");
  const person = personFromInput(input);
  const phone = normalizePhone(input.phone);
  const guestEmail = normalizeGuestEmail(input.email || input.guestEmail);
  const partySize = Number(input.partySize);
  const time = String(input.time || "");
  const today = localDateString(new Date());
  if (!isValidBookingDate(date)) return "Choose a valid booking date.";
  if (date < today) return "Bookings cannot be made for past dates.";
  if (!person.lastName || person.lastName.length > 80) return "Enter a valid guest last name.";
  if (!person.firstName || person.firstName.length > 80) return "Enter a valid guest first name.";
  if (!phone || !/^[0-9+\-()\s]{6,24}$/.test(phone)) return "Enter a valid phone number.";
  if (guestEmail && !isValidEmail(guestEmail)) return "Enter a valid email address.";
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > restaurant.maxPartySize) {
    return "Party size must be between 1 and " + restaurant.maxPartySize + ".";
  }
  if (String(input.notes || "").trim().length > 300) return "Notes must be 300 characters or fewer.";
  if (!isValidTime(time)) return "Choose a valid time.";
  const servicePeriods = servicePeriodsFor(restaurant);
  if (!isTimeInServicePeriods(time, servicePeriods)) {
    return "Time must be within " + formatServicePeriods(servicePeriods) + ".";
  }
  if (date === today && new Date(date + "T" + time + ":00") < new Date()) {
    return "That time has already passed today. Choose another time or date.";
  }
  return "";
}

function capacityError(input, restaurant, bookings, excludeCode) {
  const date = String(input.date || "");
  const time = String(input.time || "");
  const partySize = Number(input.partySize);
  const currentGuests = bookings
    .filter(function (booking) {
      return booking.restaurantId === restaurant.id &&
        booking.date === date &&
        booking.time === time &&
        String(booking.code || "").toUpperCase() !== String(excludeCode || "").toUpperCase() &&
        activeBooking(booking);
    })
    .reduce(function (total, booking) { return total + Number(booking.partySize || 0); }, 0);
  const capacity = Number(restaurant.timeSlotCapacity || Math.max(restaurant.maxPartySize || 1, 20));
  if (currentGuests + partySize > capacity) {
    return "That time is full. " + Math.max(0, capacity - currentGuests) + " seats are still available.";
  }
  return "";
}

function bookingResponse(booking, options) {
  const includePrivate = Boolean(options && options.includePrivate);
  return {
    id: booking.id,
    code: booking.code,
    restaurantId: booking.restaurantId,
    restaurant: booking.restaurant,
    date: booking.date,
    firstName: booking.firstName || "",
    lastName: booking.lastName || "",
    name: bookingDisplayName(booking),
    phone: includePrivate ? (booking.phone || "") : undefined,
    email: includePrivate ? (booking.email || "") : undefined,
    time: booking.time,
    partySize: booking.partySize,
    notes: booking.notes || "",
    status: booking.status,
    createdAt: booking.createdAt,
    cancelledAt: booking.cancelledAt,
    noShowAt: booking.noShowAt
  };
}

function publicBookingResponse(booking) {
  return {
    code: booking.code,
    date: booking.date,
    firstName: booking.firstName || "",
    lastName: booking.lastName || "",
    name: bookingDisplayName(booking),
    time: booking.time,
    partySize: booking.partySize,
    notes: booking.notes || "",
    status: booking.status
  };
}

function emailConfig() {
  const user = String(process.env.GMAIL_USER || "").trim();
  const appPassword = String(process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || "").trim();
  if (!user || !appPassword) return null;
  return {
    user: user,
    appPassword: appPassword,
    fromName: String(process.env.EMAIL_FROM_NAME || "TenSeat").trim() || "TenSeat"
  };
}

function emailStatusSkipped(reason) {
  return { sent: false, skipped: true, reason: reason };
}

function getEmailTransporter() {
  const config = emailConfig();
  if (!config) return null;
  const key = config.user + ":" + config.appPassword;
  if (!emailTransporter || emailTransporterKey !== key) {
    emailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.user,
        pass: config.appPassword
      }
    });
    emailTransporterKey = key;
  }
  return emailTransporter;
}

function publicBaseUrl(request) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  const host = String(request.headers.host || "127.0.0.1:" + PORT);
  const proto = TRUST_PROXY ? String(request.headers["x-forwarded-proto"] || "https").split(",")[0].trim() : "http";
  return proto + "://" + host;
}

function googleMapsSearchUrl(restaurant) {
  const query = encodeURIComponent(restaurant.googleMapsQuery || restaurant.address || restaurant.name);
  return "https://www.google.com/maps/search/?api=1&query=" + query;
}

function bookingCancelUrl(restaurant, booking, baseUrl) {
  return baseUrl.replace(/\/$/, "") + "/r/" + restaurant.slug + "?cancel=" + encodeURIComponent(booking.code);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bookingEmailSubject(restaurant, booking) {
  return "Booking confirmed - " + restaurant.name + " - " + booking.date + " " + booking.time;
}

function bookingConfirmationText(restaurant, booking, links) {
  return [
    "Your booking is confirmed.",
    "",
    "Restaurant: " + restaurant.name,
    "Date: " + booking.date,
    "Time: " + booking.time,
    "Party size: " + booking.partySize,
    "Address: " + (restaurant.address || ""),
    "Google Maps: " + links.mapsUrl,
    "Booking code: " + booking.code,
    "Cancel booking: " + links.cancelUrl,
    "",
    "Please save your booking code in case you need to cancel."
  ].join("\n");
}

function bookingConfirmationHtml(restaurant, booking, links) {
  const rows = [
    ["Restaurant", restaurant.name],
    ["Date", booking.date],
    ["Time", booking.time],
    ["Party size", booking.partySize],
    ["Address", restaurant.address || ""],
    ["Booking code", booking.code]
  ].map(function (row) {
    return "<tr><th>" + escapeHtml(row[0]) + "</th><td>" + escapeHtml(row[1]) + "</td></tr>";
  }).join("");

  return "<!doctype html><html><body style=\"margin:0;background:#f5f3ec;color:#18211f;font-family:Arial,sans-serif;\">" +
    "<div style=\"max-width:620px;margin:0 auto;padding:28px 18px;\">" +
    "<div style=\"background:#ffffff;border:1px solid #ddd9cd;border-radius:8px;overflow:hidden;\">" +
    "<div style=\"padding:24px;background:#0a3f35;color:#ffffff;\"><p style=\"margin:0 0 8px;color:#c9952f;font-weight:800;letter-spacing:.08em;text-transform:uppercase;\">Booking confirmed</p>" +
    "<h1 style=\"margin:0;font-family:Georgia,serif;font-size:32px;\">" + escapeHtml(restaurant.name) + "</h1></div>" +
    "<div style=\"padding:24px;\"><p style=\"margin:0 0 18px;font-size:16px;line-height:1.5;\">Your booking is confirmed. Please save your booking code.</p>" +
    "<table style=\"width:100%;border-collapse:collapse;margin:0 0 20px;\">" + rows + "</table>" +
    "<p style=\"margin:0 0 12px;\"><a href=\"" + escapeHtml(links.mapsUrl) + "\" style=\"color:#11644f;font-weight:800;\">Open Google Maps</a></p>" +
    "<p style=\"margin:0;\"><a href=\"" + escapeHtml(links.cancelUrl) + "\" style=\"color:#c65f3d;font-weight:800;\">Cancel booking</a></p>" +
    "</div></div></div></body></html>";
}

async function sendBookingConfirmationEmail(options) {
  const recipient = normalizeGuestEmail(options.to);
  if (!recipient) return emailStatusSkipped("missing_recipient");
  if (!isValidEmail(recipient)) return emailStatusSkipped("invalid_recipient");
  const config = emailConfig();
  if (!config) return emailStatusSkipped("gmail_not_configured");
  const transporter = getEmailTransporter();
  const links = {
    mapsUrl: googleMapsSearchUrl(options.restaurant),
    cancelUrl: bookingCancelUrl(options.restaurant, options.booking, options.baseUrl)
  };
  await transporter.sendMail({
    from: "\"" + config.fromName.replace(/"/g, "") + "\" <" + config.user + ">",
    to: recipient,
    subject: bookingEmailSubject(options.restaurant, options.booking),
    text: bookingConfirmationText(options.restaurant, options.booking, links),
    html: bookingConfirmationHtml(options.restaurant, options.booking, links)
  });
  return { sent: true, to: recipient };
}

async function findRestaurantBySlug(slug) {
  const restaurants = await readArray(RESTAURANTS_FILE);
  return restaurants.find(function (restaurant) { return restaurant.slug === slug; }) || null;
}

async function handleRegister(request, response) {
  const input = await parseBody(request, response);
  if (!input) return;
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");
  const settings = {
    name: String(input.name || "").trim(),
    servicePeriods: servicePeriodsFromInput(input, true),
    maxPartySize: Number(input.maxPartySize || 20),
    timeSlotCapacity: Number(input.timeSlotCapacity || input.maxGuestsPerTime || input.maxPartySize || 20)
  };
  const settingsError = validateRestaurantSettings(settings);
  const passwordError = validatePassword(password);
  if (settingsError) return sendJson(response, 400, { ok: false, error: settingsError });
  if (!isValidEmail(email)) return sendJson(response, 400, { ok: false, error: "Enter a valid login email." });
  if (passwordError) return sendJson(response, 400, { ok: false, error: passwordError });

  const passwordFields = await passwordRecord(password);
  let created;
  let conflict = "";
  dataWriteQueue = dataWriteQueue.then(async function () {
    const restaurants = await readArray(RESTAURANTS_FILE);
    if (restaurants.some(function (restaurant) { return restaurant.ownerEmail === email; })) {
      conflict = "This email is already registered.";
      return;
    }
    const baseSlug = makeSlug(settings.name);
    let slug = baseSlug;
    let suffix = 2;
    while (restaurants.some(function (restaurant) { return restaurant.slug === slug; })) {
      slug = baseSlug + "-" + suffix;
      suffix += 1;
    }
    created = {
      id: crypto.randomUUID(),
      slug: slug,
      name: settings.name,
      ownerEmail: email,
      passwordSalt: passwordFields.passwordSalt,
      passwordHash: passwordFields.passwordHash,
      address: String(input.address || settings.name).trim().slice(0, 160),
      googleMapsQuery: String(input.googleMapsQuery || settings.name + " restaurant").trim().slice(0, 160),
      openingTime: settings.servicePeriods[0].openingTime,
      closingTime: settings.servicePeriods[settings.servicePeriods.length - 1].closingTime,
      servicePeriods: settings.servicePeriods,
      maxPartySize: settings.maxPartySize,
      timeSlotCapacity: settings.timeSlotCapacity,
      plan: "TenSeat",
      priceMonthly: 10,
      currency: "AUD",
      subscriptionStatus: "trialing",
      mustChangePassword: false,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    };
    restaurants.push(created);
    await writeArray(RESTAURANTS_FILE, restaurants);
  });
  await dataWriteQueue;
  if (conflict) return sendJson(response, 409, { ok: false, error: conflict });
  sendJson(response, 201, { ok: true, token: issueToken(created.id), restaurant: ownerRestaurant(created) });
}

async function handleLogin(request, response) {
  const input = await parseBody(request, response);
  if (!input) return;
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");
  const restaurants = await readArray(RESTAURANTS_FILE);
  const restaurant = restaurants.find(function (candidate) { return candidate.ownerEmail === email; });
  if (!restaurant || !(await passwordMatches(password, restaurant))) {
    return sendJson(response, 401, { ok: false, error: "Email or password is incorrect." });
  }
  sendJson(response, 200, { ok: true, token: issueToken(restaurant.id), restaurant: ownerRestaurant(restaurant) });
}

async function handleOwnerMe(request, response) {
  const restaurant = await authenticatedRestaurant(request);
  if (!restaurant) return sendJson(response, 401, { ok: false, error: "Please log in again." });
  sendJson(response, 200, { ok: true, restaurant: ownerRestaurant(restaurant) });
}

async function handleUpdateRestaurant(request, response) {
  const authenticated = await authenticatedRestaurant(request);
  if (!authenticated) return sendJson(response, 401, { ok: false, error: "Please log in again." });
  const input = await parseBody(request, response);
  if (!input) return;
  const settings = {
    name: String(input.name || "").trim(),
    servicePeriods: servicePeriodsFromInput(input, false),
    maxPartySize: Number(input.maxPartySize),
    timeSlotCapacity: Number(input.timeSlotCapacity || input.maxGuestsPerTime || input.maxPartySize)
  };
  const settingsError = validateRestaurantSettings(settings);
  if (settingsError) return sendJson(response, 400, { ok: false, error: settingsError });

  let updated;
  dataWriteQueue = dataWriteQueue.then(async function () {
    const restaurants = await readArray(RESTAURANTS_FILE);
    const restaurant = restaurants.find(function (candidate) { return candidate.id === authenticated.id; });
    if (!restaurant) return;
    restaurant.name = settings.name;
    restaurant.address = String(input.address || settings.name).trim().slice(0, 160);
    restaurant.googleMapsQuery = String(input.googleMapsQuery || settings.name + " restaurant").trim().slice(0, 160);
    restaurant.openingTime = settings.servicePeriods[0].openingTime;
    restaurant.closingTime = settings.servicePeriods[settings.servicePeriods.length - 1].closingTime;
    restaurant.servicePeriods = settings.servicePeriods;
    restaurant.maxPartySize = settings.maxPartySize;
    restaurant.timeSlotCapacity = settings.timeSlotCapacity;
    restaurant.updatedAt = new Date().toISOString();
    updated = restaurant;
    await writeArray(RESTAURANTS_FILE, restaurants);
  });
  await dataWriteQueue;
  sendJson(response, 200, { ok: true, restaurant: ownerRestaurant(updated) });
}

async function handleChangePassword(request, response) {
  const authenticated = await authenticatedRestaurant(request);
  if (!authenticated) return sendJson(response, 401, { ok: false, error: "Please log in again." });
  const input = await parseBody(request, response);
  if (!input) return;
  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");
  if (!(await passwordMatches(currentPassword, authenticated))) {
    return sendJson(response, 400, { ok: false, error: "Current password is incorrect." });
  }
  if (newPassword === currentPassword) return sendJson(response, 400, { ok: false, error: "New password must be different from the current password." });
  const passwordError = validatePassword(newPassword);
  if (passwordError) return sendJson(response, 400, { ok: false, error: passwordError });
  const passwordFields = await passwordRecord(newPassword);
  let updated;
  dataWriteQueue = dataWriteQueue.then(async function () {
    const restaurants = await readArray(RESTAURANTS_FILE);
    const restaurant = restaurants.find(function (candidate) { return candidate.id === authenticated.id; });
    restaurant.passwordSalt = passwordFields.passwordSalt;
    restaurant.passwordHash = passwordFields.passwordHash;
    restaurant.mustChangePassword = false;
    restaurant.updatedAt = new Date().toISOString();
    updated = restaurant;
    await writeArray(RESTAURANTS_FILE, restaurants);
  });
  await dataWriteQueue;
  sendJson(response, 200, { ok: true, restaurant: ownerRestaurant(updated) });
}

async function handleOwnerTestEmail(request, response) {
  const restaurant = await authenticatedRestaurant(request);
  if (!restaurant) return sendJson(response, 401, { ok: false, error: "Please log in again." });
  const input = await parseBody(request, response);
  if (!input) return;
  const to = normalizeGuestEmail(input.to || input.email);
  if (!to || !isValidEmail(to)) return sendJson(response, 400, { ok: false, error: "Enter a valid test email address." });
  const now = new Date();
  const sampleBooking = {
    code: "TS-TEST1",
    date: localDateString(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    time: servicePeriodsFor(restaurant)[0].openingTime,
    partySize: 2
  };
  try {
    const email = await sendBookingConfirmationEmail({
      to: to,
      restaurant: restaurant,
      booking: sampleBooking,
      baseUrl: publicBaseUrl(request)
    });
    if (!email.sent) return sendJson(response, 503, { ok: false, error: "Gmail email is not configured.", email: email });
    sendJson(response, 200, { ok: true, email: email });
  } catch (error) {
    console.error("Test email failed:", error.message);
    sendJson(response, 502, { ok: false, error: "Test email could not be sent. Check the Gmail App Password.", details: error.message });
  }
}

async function handleCreateBooking(request, response, restaurant) {
  const input = await parseBody(request, response);
  if (!input) return;
  const validationError = validateBooking(input, restaurant);
  if (validationError) return sendJson(response, 400, { ok: false, error: validationError });
  const person = personFromInput(input);
  const phone = normalizePhone(input.phone);
  const guestEmail = normalizeGuestEmail(input.email || input.guestEmail);
  let booking;
  let fullError = "";
  dataWriteQueue = dataWriteQueue.then(async function () {
    const bookings = await readArray(BOOKINGS_FILE);
    fullError = capacityError(input, restaurant, bookings);
    if (fullError) return;
    booking = {
      id: crypto.randomUUID(),
      code: makeBookingCode(bookings),
      restaurantId: restaurant.id,
      restaurant: restaurant.name,
      date: String(input.date),
      firstName: person.firstName,
      lastName: person.lastName,
      name: person.displayName,
      phone: phone,
      email: guestEmail,
      time: String(input.time),
      partySize: Number(input.partySize),
      notes: normalizeNotes(input.notes),
      source: "customer",
      status: "confirmed",
      createdAt: new Date().toISOString()
    };
    bookings.push(booking);
    await writeArray(BOOKINGS_FILE, bookings);
  });
  await dataWriteQueue;
  if (fullError) return sendJson(response, 409, { ok: false, error: fullError });
  let emailStatus = emailStatusSkipped(guestEmail ? "gmail_not_configured" : "missing_recipient");
  try {
    emailStatus = await sendBookingConfirmationEmail({
      to: guestEmail,
      restaurant: restaurant,
      booking: booking,
      baseUrl: publicBaseUrl(request)
    });
  } catch (error) {
    console.error("Booking email failed:", error.message);
    emailStatus = { sent: false, skipped: false, reason: "send_failed" };
  }
  sendJson(response, 201, { ok: true, booking: publicBookingResponse(booking), email: emailStatus });
}

async function handleCancelBooking(request, response, restaurant) {
  const input = await parseBody(request, response);
  if (!input) return;
  const code = String(input.code || "").trim().toUpperCase();
  if (!/^(C[A-F0-9]{6,16}|TS-[A-Z0-9]{6})$/.test(code)) {
    return sendJson(response, 400, { ok: false, error: "Enter a valid booking code." });
  }
  let outcome = "not_found";
  let cancelledBooking;
  dataWriteQueue = dataWriteQueue.then(async function () {
    const bookings = await readArray(BOOKINGS_FILE);
    const booking = bookings.find(function (candidate) {
      return candidate.restaurantId === restaurant.id && String(candidate.code || "").toUpperCase() === code;
    });
    if (!booking) return;
    cancelledBooking = booking;
    if (booking.status === "cancelled") {
      outcome = "already_cancelled";
      return;
    }
    booking.status = "cancelled";
    booking.cancelledAt = new Date().toISOString();
    outcome = "cancelled";
    await writeArray(BOOKINGS_FILE, bookings);
  });
  await dataWriteQueue;
  if (outcome === "not_found") return sendJson(response, 404, { ok: false, error: "Booking code not found." });
  if (outcome === "already_cancelled") return sendJson(response, 409, { ok: false, error: "This booking has already been cancelled." });
  sendJson(response, 200, { ok: true, booking: publicBookingResponse(cancelledBooking) });
}

async function handleOwnerCreateBooking(request, response) {
  const restaurant = await authenticatedRestaurant(request);
  if (!restaurant) return sendJson(response, 401, { ok: false, error: "Please log in again." });
  const input = await parseBody(request, response);
  if (!input) return;
  const validationError = validateBooking(input, restaurant);
  if (validationError) return sendJson(response, 400, { ok: false, error: validationError });
  const person = personFromInput(input);
  const phone = normalizePhone(input.phone);
  const guestEmail = normalizeGuestEmail(input.email || input.guestEmail);

  let booking;
  let fullError = "";
  dataWriteQueue = dataWriteQueue.then(async function () {
    const bookings = await readArray(BOOKINGS_FILE);
    fullError = capacityError(input, restaurant, bookings);
    if (fullError) return;
    booking = {
      id: crypto.randomUUID(),
      code: makeBookingCode(bookings),
      restaurantId: restaurant.id,
      restaurant: restaurant.name,
      date: String(input.date),
      firstName: person.firstName,
      lastName: person.lastName,
      name: person.displayName,
      phone: phone,
      email: guestEmail,
      time: String(input.time),
      partySize: Number(input.partySize),
      notes: normalizeNotes(input.notes),
      source: "owner",
      status: "confirmed",
      createdAt: new Date().toISOString()
    };
    bookings.push(booking);
    await writeArray(BOOKINGS_FILE, bookings);
  });
  await dataWriteQueue;
  if (fullError) return sendJson(response, 409, { ok: false, error: fullError });
  sendJson(response, 201, { ok: true, booking: bookingResponse(booking, { includePrivate: true }) });
}

async function handleOwnerUpdateBooking(request, response, code) {
  const restaurant = await authenticatedRestaurant(request);
  if (!restaurant) return sendJson(response, 401, { ok: false, error: "Please log in again." });
  const input = await parseBody(request, response);
  if (!input) return;
  const nextStatus = String(input.status || "").trim();
  if (!["confirmed", "cancelled", "no_show"].includes(nextStatus)) {
    return sendJson(response, 400, { ok: false, error: "Choose a valid booking status." });
  }

  let updated;
  dataWriteQueue = dataWriteQueue.then(async function () {
    const bookings = await readArray(BOOKINGS_FILE);
    const booking = bookings.find(function (candidate) {
      return candidate.restaurantId === restaurant.id &&
        String(candidate.code || "").toUpperCase() === String(code || "").toUpperCase();
    });
    if (!booking) return;
    booking.status = nextStatus;
    if (nextStatus === "cancelled") booking.cancelledAt = new Date().toISOString();
    if (nextStatus === "no_show") booking.noShowAt = new Date().toISOString();
    if (nextStatus === "confirmed") {
      delete booking.cancelledAt;
      delete booking.noShowAt;
    }
    booking.updatedAt = new Date().toISOString();
    updated = booking;
    await writeArray(BOOKINGS_FILE, bookings);
  });
  await dataWriteQueue;
  if (!updated) return sendJson(response, 404, { ok: false, error: "Booking not found." });
  sendJson(response, 200, { ok: true, booking: bookingResponse(updated, { includePrivate: true }) });
}

async function handleOwnerBookings(request, response, requestUrl) {
  const restaurant = await authenticatedRestaurant(request);
  if (!restaurant) return sendJson(response, 401, { ok: false, error: "Please log in again." });
  const requestedDate = String(requestUrl.searchParams.get("date") || localDateString(new Date()));
  if (!isValidBookingDate(requestedDate)) {
    return sendJson(response, 400, { ok: false, error: "Date format is invalid." });
  }
  const allBookings = await readArray(BOOKINGS_FILE);
  const bookings = allBookings
    .filter(function (booking) { return booking.restaurantId === restaurant.id && booking.date === requestedDate; })
    .sort(function (left, right) {
      return left.time.localeCompare(right.time) || String(left.createdAt).localeCompare(String(right.createdAt));
    });
  const active = bookings.filter(activeBooking);
  const cancelled = bookings.filter(function (booking) { return booking.status === "cancelled"; });
  const noShows = bookings.filter(function (booking) { return booking.status === "no_show"; });
  sendJson(response, 200, {
    ok: true,
    date: requestedDate,
    bookings: bookings.map(function (booking) { return bookingResponse(booking, { includePrivate: true }); }),
    summary: {
      bookingCount: active.length,
      guestCount: active.reduce(function (total, booking) { return total + booking.partySize; }, 0),
      cancelledCount: cancelled.length,
      noShowCount: noShows.length
    }
  });
}

async function servePublicFile(request, response, pathname) {
  let publicFile = PUBLIC_FILES.get(pathname);
  if (!publicFile && /^\/r\/[a-z0-9-]+\/?$/.test(pathname)) {
    publicFile = ["index.html", "text/html; charset=utf-8"];
  }
  if (!publicFile) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const content = await fs.readFile(path.join(APP_DIR, publicFile[0]));
  const headers = {
    "Content-Type": publicFile[1],
    "Content-Length": content.length,
    "Cache-Control": "no-cache"
  };
  if (publicFile[1].startsWith("text/html")) {
    headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.google.com https://*.gstatic.com https://*.googleusercontent.com https://images.unsplash.com",
      "frame-src https://www.google.com",
      "connect-src 'self' http://127.0.0.1:8795 http://localhost:8795",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; ");
  }
  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else response.end(content);
}

async function route(request, response) {
  applySecurityHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, OPTIONS"
    });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = requestUrl.pathname;
  const restaurantMatch = pathname.match(/^\/api\/restaurants\/([a-z0-9-]+)(?:\/(bookings|cancel))?$/);
  const ownerBookingMatch = pathname.match(/^\/api\/owner\/bookings\/([A-Z0-9-]+)$/i);

  if (pathname.startsWith("/api/") && enforceRateLimit(request, response, "api", RATE_LIMIT_RULES.api)) return;

  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { ok: true, product: "TenSeat", priceMonthly: 10, currency: "AUD" });
  }
  if (request.method === "POST" && pathname === "/api/owner/register") {
    if (enforceRateLimit(request, response, "auth", RATE_LIMIT_RULES.auth)) return;
    return handleRegister(request, response);
  }
  if (request.method === "POST" && pathname === "/api/owner/login") {
    if (enforceRateLimit(request, response, "auth", RATE_LIMIT_RULES.auth)) return;
    return handleLogin(request, response);
  }
  if (request.method === "GET" && pathname === "/api/owner/me") return handleOwnerMe(request, response);
  if (request.method === "PATCH" && pathname === "/api/owner/me") return handleUpdateRestaurant(request, response);
  if (request.method === "POST" && pathname === "/api/owner/change-password") return handleChangePassword(request, response);
  if (request.method === "POST" && pathname === "/api/owner/test-email") return handleOwnerTestEmail(request, response);
  if (request.method === "GET" && pathname === "/api/owner/bookings") return handleOwnerBookings(request, response, requestUrl);
  if (request.method === "POST" && pathname === "/api/owner/bookings") return handleOwnerCreateBooking(request, response);
  if (request.method === "PATCH" && ownerBookingMatch) return handleOwnerUpdateBooking(request, response, ownerBookingMatch[1]);

  if (restaurantMatch) {
    const restaurant = await findRestaurantBySlug(restaurantMatch[1]);
    if (!restaurant) return sendJson(response, 404, { ok: false, error: "Restaurant not found." });
    if (request.method === "GET" && !restaurantMatch[2]) {
      return sendJson(response, 200, { ok: true, restaurant: publicRestaurant(restaurant) });
    }
    if (request.method === "POST" && restaurantMatch[2] === "bookings") {
      if (enforceRateLimit(request, response, "booking:" + restaurant.id, RATE_LIMIT_RULES.booking)) return;
      return handleCreateBooking(request, response, restaurant);
    }
    if (request.method === "POST" && restaurantMatch[2] === "cancel") {
      if (enforceRateLimit(request, response, "cancel:" + restaurant.id, RATE_LIMIT_RULES.cancel)) return;
      return handleCancelBooking(request, response, restaurant);
    }
  }

  if (pathname.startsWith("/api/")) return sendJson(response, 404, { ok: false, error: "API endpoint not found." });
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD, POST, PATCH, OPTIONS" });
    response.end("Method not allowed");
    return;
  }
  await servePublicFile(request, response, pathname);
}

async function ensureData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (process.env.SESSION_SECRET) {
    sessionSecret = String(process.env.SESSION_SECRET);
  } else {
    try {
      sessionSecret = (await fs.readFile(SECRET_FILE, "utf8")).trim();
    } catch {
      sessionSecret = crypto.randomBytes(48).toString("hex");
      await fs.writeFile(SECRET_FILE, sessionSecret, { encoding: "utf8", mode: 0o600 });
    }
  }
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  await createStartupBackup();

  const restaurants = await readArray(RESTAURANTS_FILE);
  let chirin = restaurants.find(function (restaurant) { return restaurant.slug === "chirin"; });
  let restaurantsChanged = false;
  if (!chirin) {
    const passwordFields = await passwordRecord("Chirin1919!");
    chirin = {
      id: "restaurant-chirin",
      slug: "chirin",
      name: "Chirin",
      ownerEmail: "chirin.food191@gmail.com",
      passwordSalt: passwordFields.passwordSalt,
      passwordHash: passwordFields.passwordHash,
      address: "Chirin",
      googleMapsQuery: "Chirin restaurant",
      openingTime: "11:30",
      closingTime: "14:30",
      servicePeriods: [{ openingTime: "11:30", closingTime: "14:30" }],
      maxPartySize: 20,
      timeSlotCapacity: 20,
      plan: "TenSeat",
      priceMonthly: 10,
      currency: "AUD",
      subscriptionStatus: "trialing",
      mustChangePassword: true,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    };
    restaurants.push(chirin);
    restaurantsChanged = true;
  } else if (await passwordMatches("1919", chirin)) {
    const passwordFields = await passwordRecord("Chirin1919!");
    chirin.passwordSalt = passwordFields.passwordSalt;
    chirin.passwordHash = passwordFields.passwordHash;
    chirin.mustChangePassword = true;
    chirin.updatedAt = new Date().toISOString();
    restaurantsChanged = true;
  } else if (typeof chirin.mustChangePassword !== "boolean") {
    chirin.mustChangePassword = false;
    restaurantsChanged = true;
  }

  let restaurantA = restaurants.find(function (restaurant) { return restaurant.slug === "restaurant-a"; });
  if (!restaurantA) {
    const passwordFields = await passwordRecord("RestaurantA123");
    restaurantA = {
      id: "restaurant-a-demo",
      slug: "restaurant-a",
      name: "Restaurant A",
      ownerEmail: "restaurant.a@example.com",
      passwordSalt: passwordFields.passwordSalt,
      passwordHash: passwordFields.passwordHash,
      address: "123 Sample Street, Adelaide SA",
      googleMapsQuery: "Adelaide Central Market Adelaide",
      openingTime: "11:30",
      closingTime: "21:00",
      servicePeriods: [
        { openingTime: "11:30", closingTime: "14:30" },
        { openingTime: "17:00", closingTime: "21:00" }
      ],
      maxPartySize: 20,
      timeSlotCapacity: 30,
      plan: "TenSeat Basic",
      priceMonthly: 10,
      currency: "AUD",
      subscriptionStatus: "trialing",
      mustChangePassword: false,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    };
    restaurants.push(restaurantA);
    restaurantsChanged = true;
  }

  restaurants.forEach(function (restaurant) {
    const periods = servicePeriodsFor(restaurant);
    if (!Array.isArray(restaurant.servicePeriods) || !restaurant.servicePeriods.length) {
      restaurant.servicePeriods = periods;
      restaurantsChanged = true;
    }
    if (restaurant.openingTime !== periods[0].openingTime) {
      restaurant.openingTime = periods[0].openingTime;
      restaurantsChanged = true;
    }
    if (restaurant.closingTime !== periods[periods.length - 1].closingTime) {
      restaurant.closingTime = periods[periods.length - 1].closingTime;
      restaurantsChanged = true;
    }
    if (!Number.isInteger(Number(restaurant.timeSlotCapacity)) ||
        Number(restaurant.timeSlotCapacity) < Number(restaurant.maxPartySize || 1)) {
      restaurant.timeSlotCapacity = Math.max(Number(restaurant.maxPartySize || 1), 20);
      restaurantsChanged = true;
    }
  });
  if (restaurantsChanged || !(await fileExists(RESTAURANTS_FILE))) await writeArray(RESTAURANTS_FILE, restaurants);

  const bookings = await readArray(BOOKINGS_FILE);
  let changed = false;
  bookings.forEach(function (booking) {
    if (!booking.restaurantId) {
      booking.restaurantId = chirin.id;
      changed = true;
    }
    if (!booking.restaurant) {
      booking.restaurant = chirin.name;
      changed = true;
    }
  });
  if (changed || !(await fileExists(BOOKINGS_FILE))) await writeArray(BOOKINGS_FILE, bookings);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(function (request, response) {
  route(request, response).catch(function (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { ok: false, error: "The server could not process the request right now." });
    else response.end();
  });
});

module.exports = server;

ensureData()
  .then(function () {
    setInterval(cleanupRateLimits, 5 * 60 * 1000).unref();
    server.listen(PORT, HOST, function () {
      const displayHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
      console.log("TenSeat server: http://" + displayHost + ":" + PORT);
    });
  })
  .catch(function (error) {
    console.error("Server startup failed", error);
    process.exitCode = 1;
  });
