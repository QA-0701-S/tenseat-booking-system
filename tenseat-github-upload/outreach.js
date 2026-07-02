var isFilePreview = window.location.protocol === "file:";
var API_BASE = isFilePreview ? "http://127.0.0.1:8795" : "";
var platformToken = sessionStorage.getItem("tenseatPlatformToken") || "";
var leads = [];
var selectedLead = null;
var selectedActivities = [];
var currentDraft = null;

var statuses = [
  "new",
  "qualified",
  "email_drafted",
  "email_sent",
  "follow_up_due",
  "follow_up_sent",
  "instagram_drafted",
  "instagram_sent_manually",
  "replied",
  "demo_booked",
  "trial_started",
  "paid",
  "not_interested",
  "do_not_contact"
];

var el = {
  access: document.getElementById("outreachAccess"),
  app: document.getElementById("outreachApp"),
  loginForm: document.getElementById("outreachLoginForm"),
  password: document.getElementById("outreachPassword"),
  loginError: document.getElementById("outreachLoginError"),
  logout: document.getElementById("outreachLogoutButton"),
  refresh: document.getElementById("refreshLeadsButton"),
  showImport: document.getElementById("showImportButton"),
  hideImport: document.getElementById("hideImportButton"),
  importSection: document.getElementById("importSection"),
  importSummary: document.getElementById("importSummary"),
  csvImportForm: document.getElementById("csvImportForm"),
  csvFile: document.getElementById("csvFile"),
  csvText: document.getElementById("csvText"),
  singleLeadForm: document.getElementById("singleLeadForm"),
  singleName: document.getElementById("singleName"),
  singleSuburb: document.getElementById("singleSuburb"),
  singleCuisine: document.getElementById("singleCuisine"),
  singleEmail: document.getElementById("singleEmail"),
  singlePhone: document.getElementById("singlePhone"),
  singleWebsite: document.getElementById("singleWebsite"),
  singleInstagram: document.getElementById("singleInstagram"),
  singleSource: document.getElementById("singleSource"),
  total: document.getElementById("leadTotal"),
  qualified: document.getElementById("leadQualified"),
  followUpsDue: document.getElementById("leadFollowUpsDue"),
  doNotContact: document.getElementById("leadDoNotContact"),
  lastUpdated: document.getElementById("leadLastUpdated"),
  filters: document.getElementById("leadFilters"),
  filterSearch: document.getElementById("filterSearch"),
  filterStatus: document.getElementById("filterStatus"),
  filterSuburb: document.getElementById("filterSuburb"),
  filterMinScore: document.getElementById("filterMinScore"),
  filterBookingLink: document.getElementById("filterBookingLink"),
  filterEmail: document.getElementById("filterEmail"),
  filterInstagram: document.getElementById("filterInstagram"),
  filterDnc: document.getElementById("filterDnc"),
  filterSort: document.getElementById("filterSort"),
  rows: document.getElementById("leadRows"),
  empty: document.getElementById("leadEmpty"),
  detail: document.getElementById("leadDetail"),
  closeDetail: document.getElementById("closeDetailButton"),
  detailTitle: document.getElementById("detailTitle"),
  detailSubtitle: document.getElementById("detailSubtitle"),
  editForm: document.getElementById("leadEditForm"),
  editRestaurantName: document.getElementById("editRestaurantName"),
  editContactName: document.getElementById("editContactName"),
  editSuburb: document.getElementById("editSuburb"),
  editCity: document.getElementById("editCity"),
  editCuisine: document.getElementById("editCuisine"),
  editPhone: document.getElementById("editPhone"),
  editEmail: document.getElementById("editEmail"),
  editWebsite: document.getElementById("editWebsite"),
  editInstagram: document.getElementById("editInstagram"),
  editBookingLink: document.getElementById("editBookingLink"),
  editStatus: document.getElementById("editStatus"),
  editNextFollowUp: document.getElementById("editNextFollowUp"),
  editNotes: document.getElementById("editNotes"),
  detailScore: document.getElementById("detailScore"),
  detailScoreReason: document.getElementById("detailScoreReason"),
  emailDraft: document.getElementById("emailDraftButton"),
  emailDraftZh: document.getElementById("emailDraftZhButton"),
  instagramDraft: document.getElementById("instagramDraftButton"),
  instagramDraftZh: document.getElementById("instagramDraftZhButton"),
  copyDraft: document.getElementById("copyDraftButton"),
  openInstagram: document.getElementById("openInstagramButton"),
  markInstagramSent: document.getElementById("markInstagramSentButton"),
  doNotContactButton: document.getElementById("doNotContactButton"),
  draftSubject: document.getElementById("draftSubject"),
  draftBody: document.getElementById("draftBody"),
  noteForm: document.getElementById("noteForm"),
  noteText: document.getElementById("noteText"),
  activityList: document.getElementById("activityList"),
  toast: document.getElementById("outreachToast")
};

init();

function init() {
  populateStatusSelects();
  el.loginForm.addEventListener("submit", handleLogin);
  el.logout.addEventListener("click", logout);
  el.refresh.addEventListener("click", loadLeads);
  el.showImport.addEventListener("click", function () { el.importSection.hidden = false; });
  el.hideImport.addEventListener("click", function () { el.importSection.hidden = true; });
  el.filters.addEventListener("submit", function (event) { event.preventDefault(); loadLeads(); });
  el.csvImportForm.addEventListener("submit", importCsv);
  el.singleLeadForm.addEventListener("submit", addSingleLead);
  el.closeDetail.addEventListener("click", function () { el.detail.hidden = true; });
  el.editForm.addEventListener("submit", saveLead);
  el.emailDraft.addEventListener("click", function () { generateDraft("email", "en"); });
  el.emailDraftZh.addEventListener("click", function () { generateDraft("email", "zh"); });
  el.instagramDraft.addEventListener("click", function () { generateDraft("instagram", "en"); });
  el.instagramDraftZh.addEventListener("click", function () { generateDraft("instagram", "zh"); });
  el.copyDraft.addEventListener("click", copyDraft);
  el.openInstagram.addEventListener("click", openInstagramProfile);
  el.markInstagramSent.addEventListener("click", markInstagramSent);
  el.doNotContactButton.addEventListener("click", markDoNotContact);
  el.noteForm.addEventListener("submit", addNote);
  Array.prototype.forEach.call(document.querySelectorAll("[data-status-button]"), function (button) {
    button.addEventListener("click", function () { updateLeadStatus(button.dataset.statusButton); });
  });
  if (platformToken) showDashboard();
}

function populateStatusSelects() {
  el.filterStatus.appendChild(option("all", "All"));
  statuses.forEach(function (status) {
    el.filterStatus.appendChild(option(status, label(status)));
    el.editStatus.appendChild(option(status, label(status)));
  });
}

function option(value, text) {
  var item = document.createElement("option");
  item.value = value;
  item.textContent = text;
  return item;
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
  loadLeads();
}

function logout() {
  platformToken = "";
  sessionStorage.removeItem("tenseatPlatformToken");
  el.app.hidden = true;
  el.access.hidden = false;
  el.password.value = "";
}

function queryString() {
  var params = new URLSearchParams();
  if (el.filterSearch.value.trim()) params.set("search", el.filterSearch.value.trim());
  if (el.filterStatus.value !== "all") params.set("status", el.filterStatus.value);
  if (el.filterSuburb.value.trim()) params.set("suburb", el.filterSuburb.value.trim());
  if (el.filterMinScore.value) params.set("minScore", el.filterMinScore.value);
  if (el.filterBookingLink.value !== "all") params.set("hasBookingLink", el.filterBookingLink.value);
  if (el.filterEmail.value !== "all") params.set("hasEmail", el.filterEmail.value);
  if (el.filterInstagram.value !== "all") params.set("hasInstagram", el.filterInstagram.value);
  if (el.filterDnc.value !== "all") params.set("doNotContact", el.filterDnc.value);
  params.set("sort", el.filterSort.value);
  var query = params.toString();
  return query ? "?" + query : "";
}

async function loadLeads() {
  if (!platformToken) return;
  try {
    var result = await jsonRequest("/api/platform/outreach/leads" + queryString(), { method: "GET" });
    leads = result.leads || [];
    renderSummary(result.summary || {});
    renderLeads();
  } catch (error) {
    showToast(error.message);
    if (/log in/i.test(error.message)) logout();
  }
}

function renderSummary(summary) {
  el.total.textContent = summary.total || 0;
  el.qualified.textContent = summary.qualified || 0;
  el.followUpsDue.textContent = summary.followUpsDue || 0;
  el.doNotContact.textContent = summary.doNotContact || 0;
  el.lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
    " · " + (summary.filtered || 0) + " shown";
}

function renderLeads() {
  el.rows.textContent = "";
  el.empty.hidden = leads.length > 0;
  leads.forEach(function (lead) {
    var row = document.createElement("tr");
    row.appendChild(cell(lead.restaurantName, "guest-name", "Restaurant"));
    row.appendChild(cell(lead.suburb || "-", "", "Suburb"));
    row.appendChild(cell(ratingText(lead), "", "Rating"));
    row.appendChild(linkCell(lead.website, lead.hasWebsite ? "Website" : "-", "Website"));
    row.appendChild(cell(lead.email || "-", "booking-email", "Email"));
    row.appendChild(instagramCell(lead));
    row.appendChild(cell(bookingLinkLabel(lead.hasBookingLink), "booking-status " + bookingTone(lead.hasBookingLink), "Booking"));
    row.appendChild(cell(String(lead.leadScore), "lead-score-pill", "Score"));
    row.appendChild(cell(label(lead.status), "booking-status " + statusTone(lead.status), "Status"));
    row.appendChild(cell(dateLabel(lead.nextFollowUpAt), "received-time", "Next follow-up"));
    row.appendChild(actionsCell(lead));
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

function linkCell(url, text, labelText) {
  var td = document.createElement("td");
  if (labelText) td.dataset.label = labelText;
  if (!url) {
    td.textContent = text || "-";
    return td;
  }
  var link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.className = "quiet-link";
  link.textContent = text || "Open";
  td.appendChild(link);
  return td;
}

function instagramCell(lead) {
  if (!lead.instagramHandle) return cell("-", "", "Instagram");
  return linkCell("https://instagram.com/" + encodeURIComponent(lead.instagramHandle), "@" + lead.instagramHandle, "Instagram");
}

function actionsCell(lead) {
  var td = document.createElement("td");
  td.dataset.label = "Actions";
  var actions = document.createElement("div");
  actions.className = "booking-actions";
  actions.appendChild(actionButton("View", "", function () { selectLead(lead.id); }));
  actions.appendChild(actionButton("Email", "", function () { selectLead(lead.id).then(function () { generateDraft("email", "en"); }); }));
  actions.appendChild(actionButton("DM", "", function () { selectLead(lead.id).then(function () { generateDraft("instagram", "en"); }); }));
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

async function selectLead(id) {
  try {
    var result = await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(id), { method: "GET" });
    selectedLead = result.lead;
    selectedActivities = result.activities || [];
    currentDraft = null;
    renderDetail();
    el.detail.hidden = false;
  } catch (error) {
    showToast(error.message);
  }
}

function renderDetail() {
  if (!selectedLead) return;
  el.detailTitle.textContent = selectedLead.restaurantName;
  el.detailSubtitle.textContent = [selectedLead.suburb, selectedLead.cuisineType, selectedLead.email].filter(Boolean).join(" · ") || "Lead details";
  el.editRestaurantName.value = selectedLead.restaurantName || "";
  el.editContactName.value = selectedLead.contactName || "";
  el.editSuburb.value = selectedLead.suburb || "";
  el.editCity.value = selectedLead.city || "";
  el.editCuisine.value = selectedLead.cuisineType || "";
  el.editPhone.value = selectedLead.phone || "";
  el.editEmail.value = selectedLead.email || "";
  el.editWebsite.value = selectedLead.website || "";
  el.editInstagram.value = selectedLead.instagramHandle || "";
  el.editBookingLink.value = String(selectedLead.hasBookingLink);
  el.editStatus.value = selectedLead.status || "new";
  el.editNextFollowUp.value = selectedLead.nextFollowUpAt ? selectedLead.nextFollowUpAt.slice(0, 10) : "";
  el.editNotes.value = selectedLead.notes || "";
  el.detailScore.textContent = selectedLead.leadScore || 0;
  el.detailScoreReason.textContent = selectedLead.leadScoreReason || "";
  el.draftSubject.value = "";
  el.draftBody.value = "";
  renderActivities();
}

function renderActivities() {
  el.activityList.textContent = "";
  if (!selectedActivities.length) {
    var empty = document.createElement("p");
    empty.className = "form-note";
    empty.textContent = "No activity yet.";
    el.activityList.appendChild(empty);
    return;
  }
  selectedActivities.forEach(function (activity) {
    var item = document.createElement("article");
    item.className = "activity-item";
    var title = document.createElement("strong");
    title.textContent = label(activity.type) + " · " + dateTimeLabel(activity.createdAt);
    var body = document.createElement("p");
    body.textContent = activity.subject ? activity.subject : (activity.body || activity.status || "");
    item.append(title, body);
    el.activityList.appendChild(item);
  });
}

async function saveLead(event) {
  event.preventDefault();
  if (!selectedLead) return;
  try {
    var result = await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(selectedLead.id), {
      method: "PATCH",
      body: JSON.stringify(detailPayload())
    });
    selectedLead = result.lead;
    showToast("Lead saved.");
    await selectLead(selectedLead.id);
    loadLeads();
  } catch (error) {
    showToast(error.message);
  }
}

function detailPayload() {
  return {
    restaurantName: el.editRestaurantName.value.trim(),
    contactName: el.editContactName.value.trim(),
    suburb: el.editSuburb.value.trim(),
    city: el.editCity.value.trim(),
    cuisineType: el.editCuisine.value.trim(),
    phone: el.editPhone.value.trim(),
    email: el.editEmail.value.trim(),
    website: el.editWebsite.value.trim(),
    instagramHandle: el.editInstagram.value.trim(),
    hasBookingLink: el.editBookingLink.value,
    status: el.editStatus.value,
    nextFollowUpAt: el.editNextFollowUp.value,
    notes: el.editNotes.value.trim()
  };
}

async function generateDraft(channel, language) {
  if (!selectedLead) return showToast("Select a lead first.");
  try {
    var result = await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(selectedLead.id) + "/draft", {
      method: "POST",
      body: JSON.stringify({ channel: channel, language: language })
    });
    selectedLead = result.lead;
    currentDraft = result.draft;
    var draftCopy = currentDraft;
    el.draftSubject.value = currentDraft.subject || "";
    el.draftBody.value = currentDraft.body || "";
    showToast(channel === "instagram" ? "Instagram draft generated." : "Email draft generated.");
    await selectLead(selectedLead.id);
    currentDraft = draftCopy;
    if (draftCopy) {
      el.draftSubject.value = draftCopy.subject || "";
      el.draftBody.value = draftCopy.body || "";
    }
    loadLeads();
  } catch (error) {
    showToast(error.message);
  }
}

async function copyDraft() {
  var text = [el.draftSubject.value, el.draftBody.value].filter(Boolean).join("\n\n");
  if (!text) return showToast("Generate a draft first.");
  try {
    await navigator.clipboard.writeText(text);
    if (currentDraft && currentDraft.channel === "instagram" && selectedLead) {
      await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(selectedLead.id) + "/activity", {
        method: "POST",
        body: JSON.stringify({ type: "instagram_dm_copied", body: currentDraft.body })
      });
    }
    showToast("Draft copied.");
  } catch {
    showToast("Copy failed.");
  }
}

function openInstagramProfile() {
  if (!selectedLead || !selectedLead.instagramHandle) return showToast("This lead has no Instagram handle.");
  window.open("https://instagram.com/" + encodeURIComponent(selectedLead.instagramHandle), "_blank", "noopener,noreferrer");
}

async function markInstagramSent() {
  if (!selectedLead) return;
  try {
    await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(selectedLead.id) + "/activity", {
      method: "POST",
      body: JSON.stringify({ type: "instagram_dm_sent_manually", body: el.draftBody.value })
    });
    showToast("Instagram DM marked as sent.");
    await selectLead(selectedLead.id);
    loadLeads();
  } catch (error) {
    showToast(error.message);
  }
}

async function updateLeadStatus(status) {
  if (!selectedLead) return;
  try {
    var result = await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(selectedLead.id), {
      method: "PATCH",
      body: JSON.stringify({ status: status })
    });
    selectedLead = result.lead;
    showToast("Status updated.");
    await selectLead(selectedLead.id);
    loadLeads();
  } catch (error) {
    showToast(error.message);
  }
}

async function markDoNotContact() {
  if (!selectedLead) return;
  var reason = window.prompt("Reason", "Requested no further contact");
  if (reason === null) return;
  try {
    await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(selectedLead.id), {
      method: "PATCH",
      body: JSON.stringify({ doNotContact: true, doNotContactReason: reason })
    });
    showToast("Marked do not contact.");
    await selectLead(selectedLead.id);
    loadLeads();
  } catch (error) {
    showToast(error.message);
  }
}

async function addNote(event) {
  event.preventDefault();
  if (!selectedLead || !el.noteText.value.trim()) return;
  try {
    await jsonRequest("/api/platform/outreach/leads/" + encodeURIComponent(selectedLead.id), {
      method: "PATCH",
      body: JSON.stringify({ noteToAdd: el.noteText.value.trim() })
    });
    el.noteText.value = "";
    showToast("Note added.");
    await selectLead(selectedLead.id);
  } catch (error) {
    showToast(error.message);
  }
}

async function importCsv(event) {
  event.preventDefault();
  try {
    var text = el.csvText.value;
    if (el.csvFile.files && el.csvFile.files[0]) text = await el.csvFile.files[0].text();
    var result = await jsonRequest("/api/platform/outreach/import", {
      method: "POST",
      body: JSON.stringify({ csvText: text })
    });
    var summary = result.summary || {};
    el.importSummary.textContent = "Created " + (summary.created || 0) + ", skipped " + (summary.skipped || 0) +
      ", duplicates " + ((summary.duplicates || []).length) + ", errors " + ((summary.errors || []).length) + ".";
    el.csvImportForm.reset();
    el.csvText.value = "";
    loadLeads();
  } catch (error) {
    showToast(error.message);
  }
}

async function addSingleLead(event) {
  event.preventDefault();
  try {
    await jsonRequest("/api/platform/outreach/leads", {
      method: "POST",
      body: JSON.stringify({
        restaurantName: el.singleName.value.trim(),
        suburb: el.singleSuburb.value.trim(),
        cuisineType: el.singleCuisine.value.trim(),
        email: el.singleEmail.value.trim(),
        phone: el.singlePhone.value.trim(),
        website: el.singleWebsite.value.trim(),
        instagramHandle: el.singleInstagram.value.trim(),
        source: el.singleSource.value.trim() || "manual"
      })
    });
    el.singleLeadForm.reset();
    el.singleSource.value = "manual";
    showToast("Lead added.");
    loadLeads();
  } catch (error) {
    showToast(error.message);
  }
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

function label(value) {
  return String(value || "").replace(/_/g, " ").replace(/^\w/, function (letter) { return letter.toUpperCase(); });
}

function ratingText(lead) {
  if (!lead.googleRating) return "-";
  return Number(lead.googleRating).toFixed(1) + " (" + Number(lead.googleReviewCount || 0) + ")";
}

function bookingLinkLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function bookingTone(value) {
  if (value === true) return "confirmed";
  if (value === false) return "cancelled";
  return "no_show";
}

function statusTone(status) {
  if (["qualified", "replied", "demo_booked", "trial_started", "paid"].includes(status)) return "confirmed";
  if (["not_interested", "do_not_contact"].includes(status)) return "cancelled";
  return "no_show";
}

function dateLabel(value) {
  return value ? String(value).slice(0, 10) : "-";
}

function dateTimeLabel(value) {
  if (!value) return "-";
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(function () { el.toast.classList.remove("show"); }, 2600);
}
