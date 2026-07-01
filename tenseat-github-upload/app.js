var isFilePreview = window.location.protocol === "file:";
var isLocalPreview = isFilePreview ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost";
var API_BASE = isFilePreview ? "http://127.0.0.1:8795" : "";
var restaurantSlug = getRestaurantSlug();
var restaurant = null;
var submitting = false;
var cancelling = false;

var el = {
  restaurantName: document.getElementById("restaurantName"),
  restaurantAddress: document.getElementById("restaurantAddress"),
  googleMap: document.getElementById("googleMap"),
  openMaps: document.getElementById("openMaps"),
  openStatus: document.getElementById("openStatus"),
  form: document.getElementById("bookingForm"),
  date: document.getElementById("bookingDate"),
  firstName: document.getElementById("bookingFirstName"),
  lastName: document.getElementById("bookingLastName"),
  phone: document.getElementById("bookingPhone"),
  email: document.getElementById("bookingEmail"),
  notes: document.getElementById("bookingNotes"),
  hour: document.getElementById("bookingHour"),
  minute: document.getElementById("bookingMinute"),
  time: document.getElementById("bookingTime"),
  timeRange: document.getElementById("timeRange"),
  timeStatus: document.getElementById("timeStatus"),
  partySize: document.getElementById("partySize"),
  summary: document.getElementById("bookingSummary"),
  submit: document.getElementById("submitBooking"),
  toast: document.getElementById("toast"),
  cancelForm: document.getElementById("cancelForm"),
  cancelCode: document.getElementById("cancelCode"),
  cancelSubmit: document.getElementById("cancelBooking"),
  cancelStatus: document.getElementById("cancelStatus"),
  receipt: document.getElementById("bookingReceipt"),
  receiptTitle: document.getElementById("receiptTitle"),
  receiptCode: document.getElementById("receiptCode"),
  receiptReminder: document.getElementById("receiptReminder"),
  receiptDetails: document.getElementById("receiptDetails"),
  receiptState: document.getElementById("receiptState"),
  copyCode: document.getElementById("copyBookingCode")
};

init();

async function init() {
  wireEvents();
  try {
    var response = await fetch(API_BASE + "/api/restaurants/" + encodeURIComponent(restaurantSlug));
    var result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not load restaurant details.");
    restaurant = result.restaurant;
    applyRestaurant();

    var today = toDateInput(new Date());
    el.date.min = today;
    el.date.value = today;
    populatePartySizes();
    populateHourOptions();
    setTimeValue(getSuggestedTime());
    updateOpenStatus();
    updateAvailability();
    loadSavedBooking();
    applyCancelCodeFromUrl();
    updateCancelState();
  } catch (error) {
    el.summary.textContent = error.message;
    el.timeStatus.textContent = "Bookings are unavailable right now.";
    el.submit.disabled = true;
    showToast(error.message);
  }
}

function getRestaurantSlug() {
  var pathMatch = window.location.pathname.match(/^\/r\/([a-z0-9-]+)/i);
  if (pathMatch) return pathMatch[1].toLowerCase();
  var querySlug = new URLSearchParams(window.location.search).get("restaurant");
  return querySlug ? querySlug.toLowerCase() : "chirin";
}

function applyRestaurant() {
  document.title = restaurant.name + " Booking - TenSeat";
  el.restaurantName.textContent = restaurant.name;
  el.restaurantAddress.textContent = restaurant.address || restaurant.name;
  el.timeRange.textContent = formatServicePeriods();
  var mapQuery = encodeURIComponent(restaurant.googleMapsQuery || restaurant.address || restaurant.name);
  el.googleMap.src = "https://www.google.com/maps?q=" + mapQuery + "&output=embed";
  el.openMaps.href = "https://www.google.com/maps/search/?api=1&query=" + mapQuery;
  setBookingFormDisabled(restaurant.acceptingBookings === false);
}

function setBookingFormDisabled(isDisabled) {
  Array.prototype.forEach.call(el.form.elements, function (field) {
    field.disabled = isDisabled;
  });
  if (!isDisabled) el.submit.disabled = true;
}

function wireEvents() {
  el.date.addEventListener("change", handleDateChange);
  el.firstName.addEventListener("input", updateSummary);
  el.lastName.addEventListener("input", updateSummary);
  el.phone.addEventListener("input", updateSummary);
  el.email.addEventListener("input", updateSummary);
  el.notes.addEventListener("input", updateSummary);
  el.hour.addEventListener("change", handleHourChange);
  el.minute.addEventListener("change", syncTimeFromPicker);
  el.partySize.addEventListener("change", updateSummary);
  el.form.addEventListener("submit", handleBookingSubmit);
  el.cancelCode.addEventListener("input", updateCancelState);
  el.cancelForm.addEventListener("submit", handleCancelSubmit);
  el.copyCode.addEventListener("click", copyBookingCode);
}

function populatePartySizes() {
  el.partySize.replaceChildren();
  for (var size = 1; size <= restaurant.maxPartySize; size += 1) {
    var option = document.createElement("option");
    option.value = String(size);
    option.textContent = size + (size === 1 ? " guest" : " guests");
    if (size === Math.min(2, restaurant.maxPartySize)) option.selected = true;
    el.partySize.appendChild(option);
  }
}

function populateHourOptions() {
  el.hour.replaceChildren(createOption("", "--"));
  getBookableHours().forEach(function (hour) {
    el.hour.appendChild(createOption(String(hour).padStart(2, "0"), String(hour).padStart(2, "0")));
  });
}

function createOption(value, label) {
  var option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function handleDateChange() {
  setTimeValue(getSuggestedTime());
  updateAvailability();
}

function handleHourChange() {
  populateMinuteOptions("");
  syncTimeFromPicker();
}

function populateMinuteOptions(preferredMinute) {
  var hour = Number(el.hour.value);
  el.minute.replaceChildren(createOption("", "--"));
  if (!el.hour.value) return;

  var minutes = getBookableMinutesForHour(hour);
  minutes.forEach(function (minute) {
    var value = String(minute).padStart(2, "0");
    el.minute.appendChild(createOption(value, value));
  });

  var preferredNumber = Number(preferredMinute);
  if (preferredMinute !== "" && minutes.includes(preferredNumber)) {
    el.minute.value = String(preferredNumber).padStart(2, "0");
  } else if (minutes.length) {
    el.minute.value = String(minutes[0]).padStart(2, "0");
  }
}

function setTimeValue(time) {
  if (!time) {
    el.hour.value = "";
    populateMinuteOptions("");
    el.time.value = "";
    return;
  }
  var parts = time.split(":");
  el.hour.value = parts[0];
  populateMinuteOptions(parts[1]);
  syncTimeFromPicker();
}

function syncTimeFromPicker() {
  el.time.value = el.hour.value && el.minute.value
    ? el.hour.value + ":" + el.minute.value
    : "";
  updateAvailability();
}

function updateAvailability() {
  if (!restaurant) return;
  var message = getBookingAvailabilityMessage() || getDateValidationMessage() || getTimeValidationMessage();
  el.timeStatus.textContent = message || "Available - 24-hour time";
  el.timeStatus.classList.toggle("available", !message);
  updateSummary();
}

function getBookingAvailabilityMessage() {
  if (restaurant && restaurant.acceptingBookings === false) {
    return "Online bookings are unavailable right now.";
  }
  return "";
}

function getDateValidationMessage() {
  if (!el.date.value) return "Choose a booking date.";
  if (el.date.value < toDateInput(new Date())) return "Bookings cannot be made for past dates.";
  return "";
}

function getGuestValidationMessage() {
  var firstName = el.firstName.value.trim();
  var lastName = el.lastName.value.trim();
  var phone = el.phone.value.trim();
  var email = el.email.value.trim();
  if (!lastName) return "Enter the guest last name.";
  if (!firstName) return "Enter the guest first name.";
  if (lastName.length > 80 || firstName.length > 80) return "Names must be 80 characters or fewer.";
  if (!phone) return "Enter a phone number.";
  if (!/^[0-9+\-()\s]{6,24}$/.test(phone)) return "Enter a valid phone number.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return "";
}

function getTimeValidationMessage() {
  if (!restaurant) return "Restaurant details are still loading.";
  if (!el.time.value) return "Choose a booking time.";
  if (!isTimeWithinRange(el.time.value)) {
    return "Time must be within " + formatServicePeriods() + ".";
  }
  if (isSelectedTimeInPast()) return "That time has already passed. Choose another time or date.";
  return "";
}

async function handleBookingSubmit(event) {
  event.preventDefault();
  var validationMessage = getBookingAvailabilityMessage() || getDateValidationMessage() || getGuestValidationMessage() || getTimeValidationMessage();
  if (validationMessage) return showToast(validationMessage);

  var confirmedCode = "";
  submitting = true;
  el.submit.textContent = "Booking...";
  updateSummary();
  try {
    var response = await fetch(API_BASE + "/api/restaurants/" + restaurant.slug + "/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: el.date.value,
        firstName: el.firstName.value.trim(),
        lastName: el.lastName.value.trim(),
        phone: el.phone.value.trim(),
        email: el.email.value.trim(),
        notes: el.notes.value.trim(),
        partySize: Number(el.partySize.value),
        time: el.time.value
      })
    });
    var result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Booking failed. Please try again.");
    confirmedCode = result.booking.code;
    saveBookingReceipt(result.booking, "confirmed");
    showBookingReceipt(result.booking, "confirmed");
    showToast(result.email && result.email.sent
      ? "Booking confirmed. Confirmation email sent."
      : "Booking confirmed. Copy and save your booking code.");
  } catch (error) {
    showToast(error instanceof TypeError ? "Could not connect to the booking service." : error.message);
  } finally {
    submitting = false;
    el.submit.textContent = "Make Booking";
    updateSummary();
    if (confirmedCode) el.summary.textContent = "Booking confirmed. Copy and save the booking code below.";
  }
}

function receiptStorageKey() {
  return "tenseatBooking:" + restaurantSlug;
}

function saveBookingReceipt(booking, status) {
  sessionStorage.setItem(receiptStorageKey(), JSON.stringify({
    code: booking.code,
    date: booking.date,
    firstName: booking.firstName || el.firstName.value.trim(),
    lastName: booking.lastName || el.lastName.value.trim(),
    name: booking.name || displayName({ firstName: el.firstName.value.trim(), lastName: el.lastName.value.trim() }),
    email: booking.email || el.email.value.trim(),
    notes: booking.notes || "",
    time: booking.time,
    partySize: booking.partySize,
    status: status
  }));
}

function getSavedBooking() {
  try {
    return JSON.parse(sessionStorage.getItem(receiptStorageKey()) || "null");
  } catch {
    return null;
  }
}

function loadSavedBooking() {
  var booking = getSavedBooking();
  if (booking && booking.code) showBookingReceipt(booking, booking.status || "confirmed");
}

function applyCancelCodeFromUrl() {
  var code = new URLSearchParams(window.location.search).get("cancel");
  if (!code) return;
  el.cancelCode.value = code.trim().toUpperCase();
  var cancelSection = document.querySelector(".cancel-booking");
  if (cancelSection) cancelSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showBookingReceipt(booking, status) {
  el.receipt.hidden = false;
  el.receipt.classList.toggle("cancelled", status === "cancelled");
  el.receiptTitle.textContent = status === "cancelled" ? "Booking cancelled" : "Booking confirmed";
  el.receiptCode.textContent = booking.code;
  el.receiptReminder.hidden = status === "cancelled";
  el.copyCode.textContent = "Copy code";
  el.receiptDetails.textContent = [
    displayName(booking),
    booking.date,
    booking.time,
    booking.partySize + (Number(booking.partySize) === 1 ? " guest" : " guests"),
    booking.email ? "Email: " + booking.email : "",
    booking.notes ? "Notes: " + booking.notes : ""
  ].filter(Boolean).join(" - ");
  el.receiptState.textContent = status === "cancelled" ? "Cancelled" : "Confirmed";
}

function displayName(booking) {
  var parts = [booking.firstName, booking.lastName].filter(Boolean);
  return parts.length ? parts.join(" ") : (booking.name || "");
}

function markSavedBookingCancelled(code) {
  var booking = getSavedBooking();
  if (booking && booking.code === code) {
    booking.status = "cancelled";
    sessionStorage.setItem(receiptStorageKey(), JSON.stringify(booking));
    showBookingReceipt(booking, "cancelled");
  }
}

async function copyBookingCode() {
  var code = el.receiptCode.textContent.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    el.copyCode.textContent = "Copied";
    showToast("Booking code copied.");
  } catch {
    showToast("Could not copy. Please write down the code.");
  }
}

async function handleCancelSubmit(event) {
  event.preventDefault();
  if (cancelling) return;
  cancelling = true;
  el.cancelSubmit.textContent = "Cancelling...";
  updateCancelState();
  el.cancelStatus.textContent = "";
  el.cancelStatus.classList.remove("cancel-status-success");
  try {
    var response = await fetch(API_BASE + "/api/restaurants/" + restaurant.slug + "/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: el.cancelCode.value.trim().toUpperCase() })
    });
    var result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not cancel the booking.");
    el.cancelStatus.textContent = "Cancelled - " + result.booking.code;
    el.cancelStatus.classList.add("cancel-status-success");
    markSavedBookingCancelled(result.booking.code);
    showToast("Cancelled - " + result.booking.code);
  } catch (error) {
    var message = error instanceof TypeError ? "Could not connect to the booking service." : error.message;
    el.cancelStatus.textContent = message;
    showToast(message);
  } finally {
    cancelling = false;
    el.cancelSubmit.textContent = "Cancel Booking";
    updateCancelState();
  }
}

function updateCancelState() {
  el.cancelSubmit.disabled = cancelling || !el.cancelCode.value.trim() || !restaurant;
}

function updateSummary() {
  if (!restaurant) return;
  var validationMessage = getBookingAvailabilityMessage() || getDateValidationMessage() || getGuestValidationMessage() || getTimeValidationMessage();
  if (restaurant.acceptingBookings === false) {
    el.summary.textContent = "Online bookings are unavailable right now.";
    el.submit.disabled = true;
    return;
  }
  if (!el.date.value || !el.time.value) {
    el.summary.textContent = "Choose a date, guest details, party size, and time.";
    el.submit.disabled = true;
    return;
  }
  el.summary.textContent = formatBookingDate(el.date.value) + " " + el.time.value +
    " - " + el.partySize.value + (Number(el.partySize.value) === 1 ? " guest" : " guests");
  el.submit.disabled = submitting || Boolean(validationMessage) || !el.form.checkValidity();
}

function isTimeWithinRange(time) {
  var value = toMinutes(time);
  return servicePeriods().some(function (period) {
    return value >= toMinutes(period.openingTime) && value <= toMinutes(period.closingTime);
  });
}

function isSelectedTimeInPast() {
  if (el.date.value !== toDateInput(new Date())) return false;
  return new Date(el.date.value + "T" + el.time.value + ":00") < new Date();
}

function getSuggestedTime() {
  var today = toDateInput(new Date());
  var periods = servicePeriods();
  if (el.date.value && el.date.value !== today) return periods[0].openingTime;
  var now = new Date();
  var nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (var index = 0; index < periods.length; index += 1) {
    var start = toMinutes(periods[index].openingTime);
    var end = toMinutes(periods[index].closingTime);
    if (nowMinutes < start) return periods[index].openingTime;
    if (nowMinutes >= start && nowMinutes < end) return fromMinutes(nowMinutes + 1);
  }
  return "";
}

function updateOpenStatus() {
  var now = new Date();
  var nowMinutes = now.getHours() * 60 + now.getMinutes();
  var open = servicePeriods().some(function (period) {
    return nowMinutes >= toMinutes(period.openingTime) && nowMinutes < toMinutes(period.closingTime);
  });
  el.openStatus.textContent = open ? "Open" : "Closed";
  el.openStatus.style.color = open ? "var(--green)" : "var(--coral)";
}

function servicePeriods() {
  var periods = Array.isArray(restaurant.servicePeriods) && restaurant.servicePeriods.length
    ? restaurant.servicePeriods
    : [{ openingTime: restaurant.openingTime, closingTime: restaurant.closingTime }];
  return periods.filter(function (period) {
    return period.openingTime && period.closingTime;
  }).sort(function (left, right) {
    return toMinutes(left.openingTime) - toMinutes(right.openingTime);
  });
}

function formatServicePeriods() {
  return servicePeriods().map(function (period) {
    return period.openingTime + "-" + period.closingTime;
  }).join(" / ");
}

function getBookableHours() {
  var hours = new Set();
  servicePeriods().forEach(function (period) {
    var firstHour = Math.floor(toMinutes(period.openingTime) / 60);
    var lastHour = Math.floor(toMinutes(period.closingTime) / 60);
    for (var hour = firstHour; hour <= lastHour; hour += 1) hours.add(hour);
  });
  return Array.from(hours).sort(function (left, right) { return left - right; });
}

function getBookableMinutesForHour(hour) {
  var minutes = [];
  for (var minute = 0; minute < 60; minute += 1) {
    var value = hour * 60 + minute;
    if (servicePeriods().some(function (period) {
      return value >= toMinutes(period.openingTime) && value <= toMinutes(period.closingTime);
    })) {
      minutes.push(minute);
    }
  }
  return minutes;
}

function formatBookingDate(value) {
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(value + "T12:00:00"));
}

function toMinutes(time) {
  var parts = time.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function fromMinutes(totalMinutes) {
  var hours = Math.floor(totalMinutes / 60) % 24;
  var minutes = totalMinutes % 60;
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

function toDateInput(date) {
  var offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(function () { el.toast.classList.remove("show"); }, 2800);
}
