var isFilePreview = window.location.protocol === "file:";
var isLocalPreview = isFilePreview ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost";
var API_BASE = isFilePreview ? "http://127.0.0.1:8795" : "";
var token = sessionStorage.getItem("tenseatOwnerToken") || "";
var restaurant = null;
var loading = false;

var el = {
  accessView: document.getElementById("accessView"),
  loginTab: document.getElementById("loginTab"),
  registerTab: document.getElementById("registerTab"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
  registerName: document.getElementById("registerName"),
  registerEmail: document.getElementById("registerEmail"),
  registerPassword: document.getElementById("registerPassword"),
  registerError: document.getElementById("registerError"),
  app: document.getElementById("adminApp"),
  logout: document.getElementById("logoutButton"),
  topbarRestaurant: document.getElementById("topbarRestaurant"),
  restaurantHeading: document.getElementById("restaurantHeading"),
  bookingsTab: document.getElementById("bookingsTab"),
  settingsTab: document.getElementById("settingsTab"),
  bookingsView: document.getElementById("bookingsView"),
  settingsView: document.getElementById("settingsView"),
  securityAlert: document.getElementById("securityAlert"),
  date: document.getElementById("bookingDate"),
  refresh: document.getElementById("refreshButton"),
  bookingCount: document.getElementById("bookingCount"),
  guestCount: document.getElementById("guestCount"),
  cancelledCount: document.getElementById("cancelledCount"),
  noShowCount: document.getElementById("noShowCount"),
  serviceTime: document.getElementById("serviceTime"),
  listTitle: document.getElementById("listTitle"),
  lastUpdated: document.getElementById("lastUpdated"),
  rows: document.getElementById("bookingRows"),
  tableWrap: document.getElementById("tableWrap"),
  empty: document.getElementById("emptyState"),
  ownerBookingForm: document.getElementById("ownerBookingForm"),
  ownerLastName: document.getElementById("ownerLastName"),
  ownerFirstName: document.getElementById("ownerFirstName"),
  ownerPhone: document.getElementById("ownerPhone"),
  ownerBookingTime: document.getElementById("ownerBookingTime"),
  ownerPartySize: document.getElementById("ownerPartySize"),
  ownerBookingNotes: document.getElementById("ownerBookingNotes"),
  planStatus: document.getElementById("planStatus"),
  bookingLink: document.getElementById("bookingLink"),
  copyLink: document.getElementById("copyLinkButton"),
  openBookingLink: document.getElementById("openBookingLink"),
  settingsForm: document.getElementById("settingsForm"),
  settingsName: document.getElementById("settingsName"),
  settingsAddress: document.getElementById("settingsAddress"),
  settingsMapQuery: document.getElementById("settingsMapQuery"),
  settingsOpening: document.getElementById("settingsOpening"),
  settingsClosing: document.getElementById("settingsClosing"),
  settingsOpening2: document.getElementById("settingsOpening2"),
  settingsClosing2: document.getElementById("settingsClosing2"),
  settingsMaxParty: document.getElementById("settingsMaxParty"),
  settingsTimeSlotCapacity: document.getElementById("settingsTimeSlotCapacity"),
  passwordForm: document.getElementById("passwordForm"),
  currentPassword: document.getElementById("currentPassword"),
  newPassword: document.getElementById("newPassword"),
  toast: document.getElementById("adminToast")
};

init();

function init() {
  el.date.value = toDateInput(new Date());
  el.loginTab.addEventListener("click", function () { showAuthMode("login"); });
  el.registerTab.addEventListener("click", function () { showAuthMode("register"); });
  el.loginForm.addEventListener("submit", handleLogin);
  el.registerForm.addEventListener("submit", handleRegister);
  el.logout.addEventListener("click", logout);
  el.bookingsTab.addEventListener("click", function () { showView("bookings"); });
  el.settingsTab.addEventListener("click", function () { showView("settings"); });
  el.date.addEventListener("change", loadBookings);
  el.refresh.addEventListener("click", loadBookings);
  el.ownerBookingForm.addEventListener("submit", createOwnerBooking);
  el.copyLink.addEventListener("click", copyBookingLink);
  el.settingsForm.addEventListener("submit", saveSettings);
  el.passwordForm.addEventListener("submit", changePassword);
  if (new URLSearchParams(window.location.search).get("mode") === "register") showAuthMode("register");
  if (token) restoreSession();
}

function showAuthMode(mode) {
  var login = mode === "login";
  el.loginForm.hidden = !login;
  el.registerForm.hidden = login;
  el.loginTab.classList.toggle("active", login);
  el.registerTab.classList.toggle("active", !login);
  el.loginTab.setAttribute("aria-selected", String(login));
  el.registerTab.setAttribute("aria-selected", String(!login));
  el.loginError.textContent = "";
  el.registerError.textContent = "";
}

async function handleLogin(event) {
  event.preventDefault();
  el.loginError.textContent = "";
  try {
    var result = await jsonRequest("/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ email: el.loginEmail.value.trim(), password: el.loginPassword.value })
    }, false);
    acceptSession(result);
  } catch (error) {
    el.loginError.textContent = error.message;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  el.registerError.textContent = "";
  try {
    var result = await jsonRequest("/api/owner/register", {
      method: "POST",
      body: JSON.stringify({
        name: el.registerName.value.trim(),
        email: el.registerEmail.value.trim(),
        password: el.registerPassword.value
      })
    }, false);
    acceptSession(result);
  } catch (error) {
    el.registerError.textContent = error.message;
  }
}

function acceptSession(result) {
  token = result.token;
  restaurant = result.restaurant;
  sessionStorage.setItem("tenseatOwnerToken", token);
  showDashboard();
}

async function restoreSession() {
  try {
    var result = await jsonRequest("/api/owner/me", { method: "GET" });
    restaurant = result.restaurant;
    showDashboard();
  } catch {
    logout();
  }
}

function showDashboard() {
  el.accessView.hidden = true;
  el.app.hidden = false;
  applyRestaurant();
  if (restaurant.mustChangePassword) {
    showView("settings");
    showToast("Please change the default password first.");
  } else {
    showView("bookings");
    loadBookings();
  }
}

function applyRestaurant() {
  document.title = restaurant.name + " - TenSeat";
  el.topbarRestaurant.textContent = restaurant.name;
  el.restaurantHeading.textContent = restaurant.name + " Bookings";
  el.serviceTime.textContent = formatServicePeriods();
  el.settingsName.value = restaurant.name;
  el.settingsAddress.value = restaurant.address || "";
  el.settingsMapQuery.value = restaurant.googleMapsQuery || "";
  var periods = servicePeriods();
  el.settingsOpening.value = periods[0] ? periods[0].openingTime : "";
  el.settingsClosing.value = periods[0] ? periods[0].closingTime : "";
  el.settingsOpening2.value = periods[1] ? periods[1].openingTime : "";
  el.settingsClosing2.value = periods[1] ? periods[1].closingTime : "";
  el.settingsMaxParty.value = restaurant.maxPartySize;
  el.settingsTimeSlotCapacity.value = restaurant.timeSlotCapacity || restaurant.maxPartySize || 20;
  el.ownerPartySize.max = restaurant.maxPartySize;
  el.ownerPartySize.value = Math.min(2, restaurant.maxPartySize || 2);
  var link = localBookingOrigin() + "/r/" + restaurant.slug;
  el.bookingLink.value = link;
  el.openBookingLink.href = link;
  el.planStatus.textContent = restaurant.subscriptionStatus === "active" ? "Active" : "Trial";
  el.securityAlert.hidden = !restaurant.mustChangePassword;
}

function localBookingOrigin() {
  return isFilePreview ? "http://127.0.0.1:8795" : window.location.origin;
}

function showView(view) {
  var bookings = view === "bookings";
  el.bookingsView.hidden = !bookings;
  el.settingsView.hidden = bookings;
  el.bookingsTab.classList.toggle("active", bookings);
  el.settingsTab.classList.toggle("active", !bookings);
}

function logout() {
  token = "";
  restaurant = null;
  sessionStorage.removeItem("tenseatOwnerToken");
  el.app.hidden = true;
  el.accessView.hidden = false;
  el.loginPassword.value = "";
  showAuthMode("login");
}

async function loadBookings() {
  if (loading || !token) return;
  loading = true;
  setLoading(true);
  try {
    var result = await jsonRequest("/api/owner/bookings?date=" + encodeURIComponent(el.date.value), { method: "GET" });
    renderBookings(result);
  } catch (error) {
    if (error.status === 401) logout();
    else showToast(error.message);
  } finally {
    loading = false;
    setLoading(false);
  }
}

function renderBookings(result) {
  el.bookingCount.textContent = result.summary.bookingCount;
  el.guestCount.textContent = result.summary.guestCount;
  el.cancelledCount.textContent = result.summary.cancelledCount;
  el.noShowCount.textContent = result.summary.noShowCount || 0;
  el.listTitle.textContent = formatDate(result.date) + " bookings";
  el.lastUpdated.textContent = "Updated at " + formatTime(new Date());
  el.rows.replaceChildren();
  el.tableWrap.hidden = !result.bookings.length;
  el.empty.hidden = Boolean(result.bookings.length);

  result.bookings.forEach(function (booking) {
    var row = document.createElement("tr");
    row.appendChild(createCell(bookingLastName(booking), "guest-name", "Last name"));
    row.appendChild(createCell(bookingFirstName(booking), "guest-name", "First name"));
    row.appendChild(createCell(booking.phone || "-", "booking-phone", "Phone"));
    row.appendChild(createCell(booking.time, "time-value", "Time"));
    var partyCell = document.createElement("td");
    partyCell.dataset.label = "Party";
    var party = document.createElement("span");
    party.className = "party-value";
    var count = document.createElement("strong");
    count.textContent = booking.partySize;
    party.append(count, document.createTextNode(Number(booking.partySize) === 1 ? " guest" : " guests"));
    partyCell.appendChild(party);
    row.appendChild(partyCell);
    var status = booking.status === "cancelled" ? "cancelled" : booking.status === "no_show" ? "no_show" : "confirmed";
    row.classList.toggle("cancelled-row", status === "cancelled");
    row.classList.toggle("no-show-row", status === "no_show");
    row.appendChild(createCell(statusLabel(status), "booking-status " + status, "Status"));
    row.appendChild(createCell(booking.notes || "-", "booking-notes", "Notes"));
    row.appendChild(createCell(booking.code, "booking-code", "Booking code"));
    row.appendChild(createCell(formatTime(new Date(booking.createdAt)), "received-time", "Received"));
    var actionsCell = createActionsCell(booking);
    actionsCell.dataset.label = "Actions";
    row.appendChild(actionsCell);
    el.rows.appendChild(row);
  });
}

function bookingFirstName(booking) {
  return booking.firstName || "-";
}

function bookingLastName(booking) {
  return booking.lastName || booking.name || "-";
}

function createCell(value, className, label) {
  var cell = document.createElement("td");
  if (label) cell.dataset.label = label;
  var content = document.createElement("span");
  content.className = className;
  content.textContent = value;
  cell.appendChild(content);
  return cell;
}

function createActionsCell(booking) {
  var cell = document.createElement("td");
  var actions = document.createElement("div");
  actions.className = "booking-actions";
  if (booking.status !== "confirmed") {
    actions.appendChild(actionButton("Restore", "restore", function () { updateBookingStatus(booking.code, "confirmed"); }));
  }
  if (booking.status !== "cancelled") {
    actions.appendChild(actionButton("Cancel", "danger", function () { updateBookingStatus(booking.code, "cancelled"); }));
  }
  if (booking.status !== "no_show") {
    actions.appendChild(actionButton("No-show", "", function () { updateBookingStatus(booking.code, "no_show"); }));
  }
  cell.appendChild(actions);
  return cell;
}

function actionButton(label, tone, handler) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "table-action" + (tone ? " " + tone : "");
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function statusLabel(status) {
  if (status === "cancelled") return "Cancelled";
  if (status === "no_show") return "No-show";
  return "Confirmed";
}

async function createOwnerBooking(event) {
  event.preventDefault();
  try {
    await jsonRequest("/api/owner/bookings", {
      method: "POST",
      body: JSON.stringify({
        date: el.date.value,
        lastName: el.ownerLastName.value.trim(),
        firstName: el.ownerFirstName.value.trim(),
        phone: el.ownerPhone.value.trim(),
        time: el.ownerBookingTime.value,
        partySize: Number(el.ownerPartySize.value),
        notes: el.ownerBookingNotes.value.trim()
      })
    });
    el.ownerBookingForm.reset();
    el.ownerPartySize.value = Math.min(2, restaurant.maxPartySize || 2);
    showToast("Booking added.");
    loadBookings();
  } catch (error) {
    showToast(error.message);
  }
}

async function updateBookingStatus(code, status) {
  try {
    await jsonRequest("/api/owner/bookings/" + encodeURIComponent(code), {
      method: "PATCH",
      body: JSON.stringify({ status: status })
    });
    showToast("Booking status updated.");
    loadBookings();
  } catch (error) {
    showToast(error.message);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    var result = await jsonRequest("/api/owner/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: el.settingsName.value.trim(),
        address: el.settingsAddress.value.trim(),
        googleMapsQuery: el.settingsMapQuery.value.trim(),
        openingTime: el.settingsOpening.value,
        closingTime: el.settingsClosing.value,
        servicePeriods: collectServicePeriods(),
        maxPartySize: Number(el.settingsMaxParty.value),
        timeSlotCapacity: Number(el.settingsTimeSlotCapacity.value)
      })
    });
    restaurant = result.restaurant;
    applyRestaurant();
    showToast("Restaurant settings saved.");
  } catch (error) {
    showToast(error.message);
  }
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

function collectServicePeriods() {
  return [
    { openingTime: el.settingsOpening.value, closingTime: el.settingsClosing.value },
    { openingTime: el.settingsOpening2.value, closingTime: el.settingsClosing2.value }
  ].filter(function (period) {
    return period.openingTime || period.closingTime;
  });
}

function formatServicePeriods() {
  return servicePeriods().map(function (period) {
    return period.openingTime + "-" + period.closingTime;
  }).join(" / ");
}

function toMinutes(time) {
  var parts = time.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

async function changePassword(event) {
  event.preventDefault();
  try {
    var result = await jsonRequest("/api/owner/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: el.currentPassword.value, newPassword: el.newPassword.value })
    });
    if (result.restaurant) {
      restaurant = result.restaurant;
      applyRestaurant();
    }
    el.passwordForm.reset();
    showToast("Password updated.");
  } catch (error) {
    showToast(error.message);
  }
}

async function copyBookingLink() {
  try {
    await navigator.clipboard.writeText(el.bookingLink.value);
    el.copyLink.textContent = "Copied";
    showToast("Booking link copied.");
    window.setTimeout(function () { el.copyLink.textContent = "Copy link"; }, 1600);
  } catch {
    showToast("Could not copy. Please select the link manually.");
  }
}

async function jsonRequest(path, options, needsAuth) {
  var requestOptions = options || {};
  var headers = { "Content-Type": "application/json" };
  if (needsAuth !== false && token) headers.Authorization = "Bearer " + token;
  requestOptions.headers = headers;
  var response = await fetch(API_BASE + path, requestOptions);
  var result = await response.json();
  if (!response.ok || !result.ok) {
    var error = new Error(result.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function setLoading(isLoading) {
  el.refresh.disabled = isLoading;
  el.refresh.classList.toggle("loading", isLoading);
  el.refresh.textContent = isLoading ? "..." : "\u21bb";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-AU", { month: "long", day: "numeric", weekday: "short" })
    .format(new Date(value + "T12:00:00"));
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function toDateInput(date) {
  var localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(function () { el.toast.classList.remove("show"); }, 2600);
}
