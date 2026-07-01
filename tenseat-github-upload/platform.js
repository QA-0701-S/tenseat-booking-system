var isFilePreview = window.location.protocol === "file:";
var API_BASE = isFilePreview ? "http://127.0.0.1:8795" : "";
var platformToken = sessionStorage.getItem("tenseatPlatformToken") || "";
var restaurants = [];

var el = {
  access: document.getElementById("platformAccess"),
  app: document.getElementById("platformApp"),
  loginForm: document.getElementById("platformLoginForm"),
  password: document.getElementById("platformPassword"),
  loginError: document.getElementById("platformLoginError"),
  logout: document.getElementById("platformLogoutButton"),
  refresh: document.getElementById("platformRefreshButton"),
  total: document.getElementById("platformTotal"),
  pending: document.getElementById("platformPending"),
  approved: document.getElementById("platformApproved"),
  suspended: document.getElementById("platformSuspended"),
  accepting: document.getElementById("platformAccepting"),
  rows: document.getElementById("platformRows"),
  empty: document.getElementById("platformEmpty"),
  lastUpdated: document.getElementById("platformLastUpdated"),
  toast: document.getElementById("platformToast")
};

init();

function init() {
  el.loginForm.addEventListener("submit", handleLogin);
  el.logout.addEventListener("click", logout);
  el.refresh.addEventListener("click", loadRestaurants);
  if (platformToken) showDashboard();
}

async function handleLogin(event) {
  event.preventDefault();
  el.loginError.textContent = "";
  try {
    var result = await jsonRequest("/api/platform/login", {
      method: "POST",
      body: JSON.stringify({ password: el.password.value })
    }, false);
    platformToken = result.token;
    sessionStorage.setItem("tenseatPlatformToken", platformToken);
    showDashboard();
  } catch (error) {
    el.loginError.textContent = error.message;
  }
}

function showDashboard() {
  el.access.hidden = true;
  el.app.hidden = false;
  loadRestaurants();
}

function logout() {
  platformToken = "";
  restaurants = [];
  sessionStorage.removeItem("tenseatPlatformToken");
  el.app.hidden = true;
  el.access.hidden = false;
  el.password.value = "";
}

async function loadRestaurants() {
  if (!platformToken) return;
  try {
    var result = await jsonRequest("/api/platform/restaurants", { method: "GET" });
    restaurants = result.restaurants || [];
    renderRestaurants();
  } catch (error) {
    showToast(error.message);
    if (/log in/i.test(error.message)) logout();
  }
}

function renderRestaurants() {
  el.rows.textContent = "";
  el.empty.hidden = restaurants.length > 0;
  el.total.textContent = restaurants.length;
  el.pending.textContent = restaurants.filter(function (restaurant) { return restaurant.approvalStatus === "pending"; }).length;
  el.approved.textContent = restaurants.filter(function (restaurant) { return restaurant.approvalStatus === "approved"; }).length;
  el.suspended.textContent = restaurants.filter(function (restaurant) { return restaurant.accountStatus === "suspended"; }).length;
  el.accepting.textContent = restaurants.filter(function (restaurant) { return restaurant.acceptingBookings; }).length;
  el.lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  restaurants.forEach(function (restaurant) {
    var row = document.createElement("tr");
    row.appendChild(cell(restaurant.name + "\n/r/" + restaurant.slug, "guest-name", "Restaurant"));
    row.appendChild(cell(restaurant.ownerEmail, "booking-email", "Email"));
    row.appendChild(cell(label(restaurant.approvalStatus), "booking-status " + statusTone(restaurant.approvalStatus), "Approval"));
    row.appendChild(cell(label(restaurant.accountStatus), "booking-status " + statusTone(restaurant.accountStatus), "Account"));
    row.appendChild(cell(planText(restaurant), "", "Plan"));
    row.appendChild(cell(restaurant.acceptingBookings ? "Open" : "Paused", "", "Bookings"));
    row.appendChild(cell(formatDate(restaurant.createdAt), "received-time", "Created"));
    row.appendChild(actionsCell(restaurant));
    el.rows.appendChild(row);
  });
}

function cell(value, className, labelText) {
  var td = document.createElement("td");
  if (labelText) td.dataset.label = labelText;
  var span = document.createElement("span");
  if (className) span.className = className;
  span.textContent = value || "-";
  td.appendChild(span);
  return td;
}

function actionsCell(restaurant) {
  var td = document.createElement("td");
  td.dataset.label = "Actions";
  var actions = document.createElement("div");
  actions.className = "booking-actions";
  if (restaurant.approvalStatus !== "approved") {
    actions.appendChild(actionButton("Approve", "", function () { updateRestaurant(restaurant.id, "approve"); }));
  }
  if (restaurant.accountStatus !== "suspended") {
    actions.appendChild(actionButton("Suspend", "danger", function () {
      var reason = window.prompt("Reason for suspension", "Paused by TenSeat admin");
      if (reason === null) return;
      updateRestaurant(restaurant.id, "suspend", reason);
    }));
  } else {
    actions.appendChild(actionButton("Restore", "restore", function () { updateRestaurant(restaurant.id, "restore"); }));
  }
  td.appendChild(actions);
  return td;
}

function actionButton(text, tone, handler) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "table-action" + (tone ? " " + tone : "");
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

async function updateRestaurant(id, action, reason) {
  try {
    await jsonRequest("/api/platform/restaurants/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ action: action, reason: reason || "" })
    });
    showToast("Restaurant updated.");
    loadRestaurants();
  } catch (error) {
    showToast(error.message);
  }
}

function label(value) {
  return String(value || "").replace(/_/g, " ").replace(/^\w/, function (letter) { return letter.toUpperCase(); });
}

function statusTone(status) {
  if (status === "approved" || status === "active") return "confirmed";
  if (status === "suspended" || status === "rejected") return "cancelled";
  return "no_show";
}

function planText(restaurant) {
  if (restaurant.billingExempt) return "Free";
  return (restaurant.plan || "TenSeat") + " A$" + Number(restaurant.priceMonthly || 0);
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

async function jsonRequest(path, options, needsAuth) {
  var requestOptions = options || {};
  var headers = { "Content-Type": "application/json" };
  if (needsAuth !== false && platformToken) headers.Authorization = "Bearer " + platformToken;
  var response = await fetch(API_BASE + path, Object.assign({}, requestOptions, { headers: headers }));
  var result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Request failed");
  return result;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(function () { el.toast.classList.remove("show"); }, 2600);
}
