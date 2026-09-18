// The browser loads this page from port 8081, but all data comes from the backend on port 8080.
const API_BASE = `${window.location.protocol}//${window.location.hostname || "localhost"}:8080`;
const app = document.getElementById("app");
const navigation = document.getElementById("navigation");
// Session storage keeps the login for this browser tab. The other values only track the current UI.
const state = {
    token: sessionStorage.getItem("jobswiperToken"),
    user: JSON.parse(sessionStorage.getItem("jobswiperUser") || "null"),
    pages: {}, filters: {}, editingJob: null, selectedJob: null
};

// Profile and job text comes from users. Escape it before inserting it into an HTML template.
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character =>
        ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
}
// Images are data URLs from the backend. Only allow the image formats the backend accepts.
function safeImage(value) {
    return typeof value === "string" && /^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(value)
        ? value : "";
}
function text(value) { return escapeHtml(value || "–"); }
function date(value) { return value ? new Date(value).toLocaleDateString("de-AT") : "–"; }
function field(label, name, value = "", options = {}) {
    const {type = "text", required = false, max = "", min = "", rows = 0, placeholder = "", id = name} = options;
    const attributes = `name="${name}" id="${id}" ${required ? "required" : ""} ${max ? `maxlength="${max}"` : ""} ${min ? `minlength="${min}"` : ""} placeholder="${escapeHtml(placeholder)}"`;
    const control = rows
        ? `<textarea class="form-control" ${attributes} rows="${rows}">${escapeHtml(value)}</textarea>`
        : `<input class="form-control" type="${type}" ${attributes} value="${escapeHtml(value)}">`;
    return `<div class="mb-3"><label class="form-label" for="${id}">${label}</label>${control}</div>`;
}
function heading(title, intro = "") {
    return `<div class="mb-4"><h1 class="h3">${title}</h1>${intro ? `<p class="text-muted mb-0">${intro}</p>` : ""}</div>`;
}
function empty(message) { return `<div class="alert alert-secondary">${message}</div>`; }
function button(label, action, id, variant = "outline-primary", extra = "") {
    return `<button type="button" class="btn btn-${variant} btn-sm" data-action="${action}" data-id="${id}" ${extra}>${label}</button>`;
}
function pageControls(key, page) {
    if (!page || page.totalPages <= 1) return "";
    return `<div class="d-flex align-items-center gap-3 mt-3">
        ${button("Zurück", "page", key, "outline-secondary", `data-page="${page.page - 1}" ${page.first ? "disabled" : ""}`)}
        <span>Seite ${page.page + 1} von ${page.totalPages}</span>
        ${button("Weiter", "page", key, "outline-secondary", `data-page="${page.page + 1}" ${page.last ? "disabled" : ""}`)}
    </div>`;
}
function showMessage(message, kind = "success") {
    const area = document.getElementById("toast-area");
    const item = document.createElement("div");
    item.className = `alert alert-${kind} shadow mb-2`;
    item.textContent = message;
    area.append(item);
    setTimeout(() => item.remove(), 5000);
}
function showError(error) { showMessage(error.message || "Ein Fehler ist aufgetreten.", "danger"); }

// Keep fetch, JWT headers, and API error handling in one place for every screen.
async function api(path, options = {}) {
    const headers = {Accept: "application/json", ...(options.body ? {"Content-Type": "application/json"} : {})};
    // Protected endpoints need the token returned by login or registration.
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, {...options, headers: {...headers, ...options.headers}});
    } catch {
        throw new Error("Backend nicht erreichbar. Bitte JobSwiperBackend auf Port 8080 starten.");
    }
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
        // An expired or invalid token sends the user back to login.
        if (response.status === 401 && state.token && !path.startsWith("/api/auth/login")) {
            clearSession();
            navigate("/login");
        }
        const fields = body?.fieldErrors ? Object.entries(body.fieldErrors).map(([name, message]) => `${name}: ${message}`).join("; ") : "";
        const error = new Error(fields || body?.message || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return body;
}
function json(data) { return JSON.stringify(data); }
// Logout only needs to remove the locally stored JWT; the backend does not keep a login session.
function clearSession() {
    sessionStorage.removeItem("jobswiperToken");
    sessionStorage.removeItem("jobswiperUser");
    state.token = null; state.user = null;
}
function setSession(auth) {
    state.token = auth.token; state.user = auth.user;
    sessionStorage.setItem("jobswiperToken", auth.token);
    sessionStorage.setItem("jobswiperUser", json(auth.user));
}
function homePath() {
    return state.user?.role === "ARBEITGEBER" ? "/employer/dashboard" :
        state.user?.role === "ADMIN" ? "/admin" : "/dashboard";
}
// Change the URL without a full page reload, then draw the screen for that URL.
function navigate(path) {
    if (location.pathname !== path) history.pushState({}, "", path);
    render();
    window.scrollTo(0, 0);
}
function renderNav() {
    const role = state.user?.role;
    const links = role === "ARBEITNEHMER" ? [
        ["Übersicht", "/dashboard"], ["Mein Profil", "/profile/edit"], ["Jobs bewerten", "/jobs/swipe"], ["Matches", "/matches"]
    ] : role === "ARBEITGEBER" ? [
        ["Übersicht", "/employer/dashboard"], ["Unternehmen", "/employer/profile/edit"],
        ["Stellenangebote", "/jobs/manage"], ["Kandidaten", "/candidates/swipe"], ["Matches", "/matches"]
    ] : role === "ADMIN" ? [["Administration", "/admin"]] : [["Anmelden", "/login"], ["Registrieren", "/register"]];
    navigation.innerHTML = links.map(([label, href]) => `<a class="btn btn-sm ${location.pathname === href ? "btn-primary" : "btn-outline-secondary"}" href="${href}" data-link>${label}</a>`).join("")
        + (role ? `<span class="small text-muted ms-2">${text(state.user.username)}</span><button class="btn btn-sm btn-outline-danger" data-action="logout">Abmelden</button>` : "");
}
async function render() {
    renderNav();
    const path = location.pathname;
    // Show login to guests and keep each role on its own pages. The backend also checks roles.
    if (!state.token && path !== "/register") {
        if (path !== "/login") history.replaceState({}, "", "/login");
        renderNav(); renderAuth("login"); return;
    }
    if (path === "/login" || path === "/register") {
        if (state.token) { history.replaceState({}, "", homePath()); return render(); }
        renderAuth(path === "/register" ? "register" : "login"); return;
    }
    const role = state.user?.role;
    const allowed = role === "ARBEITNEHMER" ? ["/dashboard", "/profile/edit", "/jobs/swipe", "/matches"]
        : role === "ARBEITGEBER" ? ["/employer/dashboard", "/employer/profile/edit", "/jobs/manage", "/candidates/swipe", "/matches"]
        : ["/admin"];
    if (!allowed.includes(path)) { history.replaceState({}, "", homePath()); renderNav(); return render(); }
    app.innerHTML = `<div class="text-muted">Laden …</div>`;
    try {
        if (path === "/dashboard" || path === "/employer/dashboard") await renderDashboard();
        else if (path === "/profile/edit") await renderEmployeeProfile();
        else if (path === "/employer/profile/edit") await renderEmployerProfile();
        else if (path === "/jobs/manage") await renderManageJobs();
        else if (path === "/jobs/swipe") await renderJobs();
        else if (path === "/candidates/swipe") await renderCandidates();
        else if (path === "/matches") await renderMatches();
        else if (path === "/admin") await renderAdmin();
    } catch (error) {
        if (!state.token && error.status === 401) return;
        app.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
    }
}

function renderAuth(mode) {
    const registering = mode === "register";
    app.innerHTML = `<div class="row justify-content-center"><div class="col-md-7 col-lg-5">
        <div class="card"><div class="card-body p-4">${heading(registering ? "Konto erstellen" : "Anmelden")}
        <form id="auth-form">
            ${field("Benutzername", "username", "", {required: true, max: "32"})}
            ${registering ? field("E-Mail", "email", "", {type: "email", required: true, max: "254"}) : ""}
            ${field("Passwort", "password", "", {type: "password", required: true, min: registering ? "8" : "", max: registering ? "72" : "", placeholder: registering ? "Mindestens 8 Zeichen" : ""})}
            ${registering ? `<div class="mb-3"><label for="role" class="form-label">Ich bin</label><select class="form-select" id="role" name="role"><option value="ARBEITNEHMER">Arbeitnehmer</option><option value="ARBEITGEBER">Arbeitgeber</option></select></div>` : ""}
            <button class="btn btn-primary w-100" type="submit">${registering ? "Registrieren" : "Anmelden"}</button>
        </form><p class="mt-3 mb-0 text-center"><a href="${registering ? "/login" : "/register"}" data-link>${registering ? "Schon ein Konto? Anmelden" : "Neues Konto erstellen"}</a></p>
        </div></div></div></div>`;
    document.getElementById("auth-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        // HTML validation runs first; the backend still validates every submitted value.
        if (!form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form));
        try {
            const auth = await api(`/api/auth/${registering ? "register" : "login"}`, {method: "POST", body: json(data)});
            setSession(auth); navigate(homePath());
            if (registering) showMessage("Konto erstellt. Bitte vervollständige dein Profil.");
        } catch (error) { showError(error); }
    });
}

// A 404 here means the user has not created a profile yet, so show an empty form.
async function ownProfile() {
    try { return await api(state.user.role === "ARBEITGEBER" ? "/api/employer/profile/me" : "/api/profile/me"); }
    catch (error) { if (error.status === 404) return null; throw error; }
}
async function renderDashboard() {
    const employer = state.user.role === "ARBEITGEBER";
    const profile = await ownProfile();
    const page = await api(employer ? "/api/jobs/mine?page=0&size=5" : "/api/jobs?page=0&size=5");
    const actions = employer ? [
        ["Unternehmensprofil", "/employer/profile/edit", "Profil pflegen"],
        ["Stellenangebote", "/jobs/manage", "Jobs anlegen und verwalten"],
        ["Kandidaten bewerten", "/candidates/swipe", "Passende Personen finden"],
        ["Matches", "/matches", "Beidseitiges Interesse ansehen"]
    ] : [
        ["Mein Profil", "/profile/edit", "Profil und Erfahrung pflegen"],
        ["Jobs bewerten", "/jobs/swipe", "Stellenangebote entdecken"],
        ["Matches", "/matches", "Beidseitiges Interesse ansehen"]
    ];
    app.innerHTML = `${heading(`Hallo, ${text(state.user.username)}!`, employer ? "Arbeitgeberbereich" : "Arbeitnehmerbereich")}
        ${!profile ? `<div class="alert alert-warning">${employer ? "Erstelle zuerst dein Unternehmensprofil, um Jobs veröffentlichen zu können." : "Erstelle zuerst dein Profil, um Jobs bewerten zu können."} <a href="${employer ? "/employer/profile/edit" : "/profile/edit"}" data-link>Profil erstellen</a></div>` : ""}
        <div class="row g-3 mb-4">${actions.map(([label, href, description]) => `<div class="col-md-6 col-lg-3"><div class="card h-100"><div class="card-body"><h2 class="h6">${label}</h2><p class="small text-muted">${description}</p><a class="btn btn-outline-primary btn-sm" href="${href}" data-link>Öffnen</a></div></div></div>`).join("")}</div>
        <h2 class="h5">${employer ? "Meine Stellenangebote" : "Neue Stellenangebote"}</h2>
        ${page.content.length ? `<div class="list-group">${page.content.map(job => `<div class="list-group-item"><strong>${text(job.title)}</strong><span class="text-muted ms-2">${text(job.location)} · ${text(job.companyName)}</span></div>`).join("")}</div>` : empty(employer ? "Noch keine Stellenangebote vorhanden." : "Derzeit gibt es keine aktiven Stellenangebote.")}`;
}

let experienceCounter = 0;
function experienceRow(item = {}) {
    // Each repeated row needs unique label IDs, even though its input names stay the same.
    const rowId = ++experienceCounter;
    return `<div class="card mb-3 experience-row"><div class="card-body">
        <div class="d-flex justify-content-between"><h3 class="h6">Berufserfahrung</h3>${button("Entfernen", "remove-experience", "", "outline-danger")}</div>
        <div class="row"><div class="col-md-6">${field("Unternehmen", "company", item.company, {required: true, max: "120", id: `company-${rowId}`})}</div>
        <div class="col-md-6">${field("Position", "position", item.position, {required: true, max: "120", id: `position-${rowId}`})}</div>
        <div class="col-md-6">${field("Von", "startDate", item.startDate, {type: "date", required: true, id: `startDate-${rowId}`})}</div>
        <div class="col-md-6">${field("Bis (optional)", "endDate", item.endDate, {type: "date", id: `endDate-${rowId}`})}</div></div>
        ${field("Beschreibung", "description", item.description, {rows: 2, max: "2000", id: `description-${rowId}`})}</div></div>`;
}
async function renderEmployeeProfile() {
    const profile = await ownProfile();
    app.innerHTML = `${heading("Mein Profil", "Dein Profil wird Arbeitgebern angezeigt.")}
        <div class="row"><div class="col-lg-8"><form id="employee-form" class="card"><div class="card-body">
        <div class="row"><div class="col-md-6">${field("Vorname", "firstName", profile?.firstName, {required: true, max: "80"})}</div>
        <div class="col-md-6">${field("Nachname", "lastName", profile?.lastName, {required: true, max: "80"})}</div>
        <div class="col-md-6">${field("Telefon", "phone", profile?.phone, {max: "40"})}</div>
        <div class="col-md-6">${field("Standort", "location", profile?.location, {max: "120"})}</div></div>
        ${field("Gewünschte Tätigkeit", "desiredPosition", profile?.desiredPosition, {max: "160"})}
        ${field("Kurzbeschreibung", "summary", profile?.summary, {rows: 4, max: "2000"})}
        ${field("Fähigkeiten (durch Komma getrennt)", "skills", profile?.skills?.join(", "), {placeholder: "Java, Verkauf, Organisation"})}
        <div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Berufserfahrung</h2>${button("Eintrag hinzufügen", "add-experience", "")}</div>
        <div id="experience-list">${(profile?.workExperience || []).map(experienceRow).join("")}</div>
        <button class="btn btn-primary" type="submit">Profil speichern</button></div></form></div>
        <div class="col-lg-4 mt-3 mt-lg-0"><div class="card"><div class="card-body"><h2 class="h5">Profilbild</h2>
        ${safeImage(profile?.profilePicture) ? `<img class="profile-image rounded mb-3" src="${profile.profilePicture}" alt="Mein Profilbild">` : `<p class="text-muted">Noch kein Bild hochgeladen.</p>`}
        <form id="image-form"><input class="form-control mb-2" type="file" name="image" accept="image/png,image/jpeg,image/gif" ${profile ? "" : "disabled"} required>
        <button class="btn btn-outline-primary btn-sm" type="submit" ${profile ? "" : "disabled"}>Bild hochladen</button></form>
        ${profile ? "" : `<p class="small text-muted mt-2 mb-0">Bitte zuerst das Profil speichern.</p>`}</div></div></div></div>`;
    document.getElementById("employee-form").addEventListener("submit", async event => {
        event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
        const values = Object.fromEntries(new FormData(form));
        // FormData alone cannot group repeated experience fields, so read each row separately.
        const workExperience = [...form.querySelectorAll(".experience-row")].map((row, sortOrder) => ({
            company: row.querySelector('[name="company"]').value.trim(), position: row.querySelector('[name="position"]').value.trim(),
            startDate: row.querySelector('[name="startDate"]').value, endDate: row.querySelector('[name="endDate"]').value || null,
            description: row.querySelector('[name="description"]').value.trim(), sortOrder
        }));
        try {
            await api("/api/profile/me", {method: "PUT", body: json({
                firstName: values.firstName.trim(), lastName: values.lastName.trim(), phone: values.phone.trim(),
                location: values.location.trim(), desiredPosition: values.desiredPosition.trim(), summary: values.summary.trim(),
                skills: values.skills.split(",").map(skill => skill.trim()).filter(Boolean), workExperience
            })});
            showMessage("Profil gespeichert."); await renderEmployeeProfile();
        } catch (error) { showError(error); }
    });
    bindImageForm("/api/profile/me/profile-picture");
}
async function renderEmployerProfile() {
    const profile = await ownProfile();
    app.innerHTML = `${heading("Unternehmensprofil", "Erstelle ein Profil, bevor du Stellenangebote veröffentlichst.")}
        <div class="row"><div class="col-lg-8"><form id="employer-form" class="card"><div class="card-body">
        ${field("Unternehmensname", "companyName", profile?.companyName, {required: true, max: "160"})}
        ${field("Kontakt-E-Mail", "contactEmail", profile?.contactEmail || state.user.email, {type: "email", required: true, max: "254"})}
        ${field("Standort", "location", profile?.location, {max: "120"})}
        ${field("Beschreibung", "description", profile?.description, {rows: 5, max: "3000"})}
        <button class="btn btn-primary" type="submit">Profil speichern</button></div></form></div>
        <div class="col-lg-4 mt-3 mt-lg-0"><div class="card"><div class="card-body"><h2 class="h5">Unternehmenslogo</h2>
        ${safeImage(profile?.companyLogo) ? `<img class="profile-image mb-3" src="${profile.companyLogo}" alt="Unternehmenslogo">` : `<p class="text-muted">Noch kein Logo hochgeladen.</p>`}
        <form id="image-form"><input class="form-control mb-2" type="file" name="image" accept="image/png,image/jpeg,image/gif" ${profile ? "" : "disabled"} required>
        <button class="btn btn-outline-primary btn-sm" type="submit" ${profile ? "" : "disabled"}>Logo hochladen</button></form>
        ${profile ? "" : `<p class="small text-muted mt-2 mb-0">Bitte zuerst das Profil speichern.</p>`}</div></div></div></div>`;
    document.getElementById("employer-form").addEventListener("submit", async event => {
        event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
        try {
            await api("/api/employer/profile/me", {method: "PUT", body: json(Object.fromEntries(new FormData(form)))});
            showMessage("Unternehmensprofil gespeichert."); await renderEmployerProfile();
        } catch (error) { showError(error); }
    });
    bindImageForm("/api/employer/profile/me/logo");
}
function bindImageForm(path) {
    document.getElementById("image-form").addEventListener("submit", async event => {
        event.preventDefault(); const file = event.currentTarget.querySelector('[name="image"]').files[0]; if (!file) return;
        if (file.size > 5 * 1024 * 1024) { showMessage("Das Bild darf höchstens 5 MB groß sein.", "danger"); return; }
        const reader = new FileReader();
        // The image endpoint expects Base64 inside JSON, not a multipart file upload.
        reader.onload = async () => {
            try {
                await api(path, {method: "PUT", body: json({imageBase64: reader.result})});
                showMessage("Bild hochgeladen."); await render();
            } catch (error) { showError(error); }
        };
        reader.readAsDataURL(file);
    });
}

async function renderManageJobs() {
    const profile = await ownProfile();
    const page = await api(`/api/jobs/mine?page=${state.pages.mine || 0}&size=10`);
    // The same form creates a new job or edits the job chosen from the current page.
    const job = state.editingJob ? page.content.find(item => String(item.id) === String(state.editingJob)) : null;
    app.innerHTML = `${heading("Stellenangebote", "Erstelle und verwalte deine eigenen Jobs.")}
        ${!profile ? `<div class="alert alert-warning">Bitte zuerst das <a href="/employer/profile/edit" data-link>Unternehmensprofil erstellen</a>.</div>` : ""}
        <div class="row g-4"><div class="col-lg-5"><div class="card"><div class="card-body">
        <h2 class="h5">${job ? "Stellenangebot bearbeiten" : "Neues Stellenangebot"}</h2>
        <form id="job-form">${field("Titel", "title", job?.title, {required: true, max: "160"})}
        ${field("Standort", "location", job?.location, {required: true, max: "120"})}
        ${field("Kategorie", "category", job?.category, {required: true, max: "100"})}
        ${field("Beschreibung", "description", job?.description, {required: true, rows: 4, max: "5000"})}
        ${field("Anforderungen", "requirements", job?.requirements, {required: true, rows: 3, max: "3000"})}
        <button class="btn btn-primary" type="submit" ${profile ? "" : "disabled"}>${job ? "Änderungen speichern" : "Job erstellen"}</button>
        ${job ? button("Abbrechen", "cancel-edit", "", "outline-secondary") : ""}</form></div></div></div>
        <div class="col-lg-7"><h2 class="h5">Meine Jobs</h2>
        ${page.content.length ? `<div class="list-group">${page.content.map(item => `<div class="list-group-item">
            <div class="d-flex justify-content-between gap-2"><div><strong>${text(item.title)}</strong><div class="small text-muted">${text(item.location)} · ${text(item.category)}</div></div>
            <span class="badge ${item.active ? "bg-success" : "bg-secondary"} align-self-start">${item.active ? "Aktiv" : "Inaktiv"}</span></div>
            <div class="d-flex gap-2 mt-2">${button("Bearbeiten", "edit-job", item.id)}
            ${button(item.active ? "Deaktivieren" : "Aktivieren", "toggle-job", item.id, "outline-secondary", `data-active="${!item.active}"`)}</div>
        </div>`).join("")}</div>${pageControls("mine", page)}` : empty("Noch keine Stellenangebote vorhanden.")}</div></div>`;
    document.getElementById("job-form").addEventListener("submit", async event => {
        event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form));
        try {
            await api(job ? `/api/jobs/${job.id}` : "/api/jobs", {method: job ? "PUT" : "POST", body: json(data)});
            state.editingJob = null; state.pages.mine = 0; showMessage(job ? "Job aktualisiert." : "Job erstellt."); await renderManageJobs();
        } catch (error) { showError(error); }
    });
}

function jobCard(job, swiping = false) {
    return `<div class="col-md-6"><article class="card h-100"><div class="card-body">
        <div class="d-flex align-items-center gap-2 mb-2">${safeImage(job.companyLogo) ? `<img class="company-logo" src="${job.companyLogo}" alt="Logo von ${text(job.companyName)}">` : ""}
        <div><h2 class="h5 mb-0">${text(job.title)}</h2><span class="text-muted">${text(job.companyName)}</span></div></div>
        <p class="small text-muted">${text(job.location)} · ${text(job.category)}</p>
        <h3 class="h6">Beschreibung</h3><p class="pre-line">${text(job.description)}</p>
        <h3 class="h6">Anforderungen</h3><p class="pre-line">${text(job.requirements)}</p>
        ${swiping ? `<div class="d-flex gap-2">${button("Gefällt mir nicht", "swipe-job", job.id, "outline-secondary", 'data-decision="DISLIKE"')}
            ${button("Gefällt mir", "swipe-job", job.id, "primary", 'data-decision="LIKE"')}</div>` : ""}
    </div></article></div>`;
}
async function renderJobs() {
    const profile = await ownProfile();
    const filters = state.filters.jobs || {};
    // URLSearchParams safely adds optional filters and the current page to the API URL.
    const params = new URLSearchParams({page: state.pages.jobs || 0, size: 10});
    if (filters.category) params.set("category", filters.category);
    if (filters.location) params.set("location", filters.location);
    const page = await api(`/api/jobs?${params}`);
    app.innerHTML = `${heading("Jobs bewerten", "Gefällt mir oder gefällt mir nicht – bei gegenseitigem Interesse entsteht ein Match.")}
        ${!profile ? `<div class="alert alert-warning">Bitte zuerst <a href="/profile/edit" data-link>dein Profil erstellen</a>.</div>` : ""}
        <form id="job-filter" class="row g-2 mb-4"><div class="col-md-4"><input class="form-control" name="category" value="${escapeHtml(filters.category)}" placeholder="Kategorie" aria-label="Kategorie"></div>
        <div class="col-md-4"><input class="form-control" name="location" value="${escapeHtml(filters.location)}" placeholder="Standort" aria-label="Standort"></div>
        <div class="col-md-4"><button class="btn btn-outline-primary" type="submit">Filtern</button></div></form>
        ${page.content.length ? `<div class="row g-3">${page.content.map(job => jobCard(job, !!profile)).join("")}</div>${pageControls("jobs", page)}` : empty("Keine Stellenangebote gefunden.")}`;
    document.getElementById("job-filter").addEventListener("submit", event => {
        event.preventDefault(); state.filters.jobs = Object.fromEntries(new FormData(event.currentTarget)); state.pages.jobs = 0; renderJobs();
    });
}

function candidateCard(profile, jobs) {
    const name = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    return `<div class="col-md-6"><article class="card h-100"><div class="card-body">
        <div class="d-flex align-items-center gap-2 mb-2">${safeImage(profile.profilePicture) ? `<img class="profile-image rounded" src="${profile.profilePicture}" alt="Profilbild von ${text(name)}">` : ""}
        <div><h2 class="h5 mb-0">${text(name)}</h2><span class="text-muted">${text(profile.desiredPosition)}</span></div></div>
        <p class="small text-muted">${text(profile.location)}</p><p class="pre-line">${text(profile.summary)}</p>
        <p><strong>Fähigkeiten:</strong> ${text((profile.skills || []).join(", "))}</p>
        ${(profile.workExperience || []).length ? `<h3 class="h6">Berufserfahrung</h3><ul class="small">${profile.workExperience.map(item => `<li>${text(item.position)} bei ${text(item.company)} (${text(item.startDate)} – ${item.endDate ? text(item.endDate) : "heute"})</li>`).join("")}</ul>` : ""}
        ${jobs.length ? `<div class="d-flex gap-2">${button("Gefällt mir nicht", "swipe-candidate", profile.user.id, "outline-secondary", 'data-decision="DISLIKE"')}
            ${button("Gefällt mir", "swipe-candidate", profile.user.id, "primary", 'data-decision="LIKE"')}</div>` : ""}
    </div></article></div>`;
}
async function renderCandidates() {
    const ownJobs = await api("/api/jobs/mine?page=0&size=100");
    const activeJobs = ownJobs.content.filter(job => job.active);
    // Employers must choose one of their active jobs before rating an employee.
    if (!activeJobs.some(job => String(job.id) === String(state.selectedJob))) state.selectedJob = activeJobs[0]?.id || null;
    const filters = state.filters.candidates || {};
    const params = new URLSearchParams({page: state.pages.candidates || 0, size: 10});
    if (filters.skill) params.set("skill", filters.skill);
    if (filters.location) params.set("location", filters.location);
    const page = await api(`/api/profile/employees?${params}`);
    app.innerHTML = `${heading("Kandidaten bewerten", "Wähle zuerst eine deiner aktiven Stellen. Ein beidseitiges Like erzeugt ein Match.")}
        ${!activeJobs.length ? `<div class="alert alert-warning">Du brauchst eine aktive Stelle. <a href="/jobs/manage" data-link>Stelle erstellen</a></div>` : `<div class="mb-3"><label class="form-label" for="candidate-job">Stellenangebot für Bewertung</label>
        <select id="candidate-job" class="form-select">${activeJobs.map(job => `<option value="${job.id}" ${String(job.id) === String(state.selectedJob) ? "selected" : ""}>${text(job.title)}</option>`).join("")}</select></div>`}
        <form id="candidate-filter" class="row g-2 mb-4"><div class="col-md-4"><input class="form-control" name="skill" value="${escapeHtml(filters.skill)}" placeholder="Fähigkeit" aria-label="Fähigkeit"></div>
        <div class="col-md-4"><input class="form-control" name="location" value="${escapeHtml(filters.location)}" placeholder="Standort" aria-label="Standort"></div>
        <div class="col-md-4"><button class="btn btn-outline-primary" type="submit">Filtern</button></div></form>
        ${page.content.length ? `<div class="row g-3">${page.content.map(item => candidateCard(item, activeJobs)).join("")}</div>${pageControls("candidates", page)}` : empty("Keine Kandidaten gefunden.")}`;
    document.getElementById("candidate-job")?.addEventListener("change", event => { state.selectedJob = event.target.value; });
    document.getElementById("candidate-filter").addEventListener("submit", event => {
        event.preventDefault(); state.filters.candidates = Object.fromEntries(new FormData(event.currentTarget)); state.pages.candidates = 0; renderCandidates();
    });
}

async function renderMatches() {
    const page = await api(`/api/matches?page=${state.pages.matches || 0}&size=10`);
    const employer = state.user.role === "ARBEITGEBER";
    app.innerHTML = `${heading("Meine Matches", "Ein Match entsteht, wenn beide Seiten dieselbe Stelle mit ‚Gefällt mir‘ bewerten.")}
        ${page.content.length ? `<div class="row g-3">${page.content.map(match => `<div class="col-md-6"><div class="card h-100"><div class="card-body">
            <span class="badge bg-success mb-2">Match</span><h2 class="h5">${text(match.jobOffer.title)}</h2>
            <p class="text-muted">${text(match.jobOffer.companyName)} · ${text(match.jobOffer.location)}</p>
            <p><strong>${employer ? "Kandidat" : "Arbeitgeber"}:</strong> ${text(employer ? match.employee.username : match.employer.username)}<br>
            <strong>Kontakt:</strong> <a href="mailto:${escapeHtml(employer ? match.employee.email : match.employer.email)}">${text(employer ? match.employee.email : match.employer.email)}</a></p>
            <p class="small text-muted mb-0">Erstellt am ${date(match.createdAt)} · ${text(match.status)}</p>
        </div></div></div>`).join("")}</div>${pageControls("matches", page)}` : empty("Noch keine Matches vorhanden.")}`;
}

function adminOverviewHtml(overview) {
    return `<div class="row g-3 mb-4">
        <div class="col-md-4"><div class="card"><div class="card-body">
            <div class="text-muted">Benutzer</div>
            <div class="fs-3">${overview.users}</div>
        </div></div></div>
        <div class="col-md-4"><div class="card"><div class="card-body">
            <div class="text-muted">Aktive Stellen</div>
            <div class="fs-3">${overview.activeJobOffers}</div>
        </div></div></div>
        <div class="col-md-4"><div class="card"><div class="card-body">
            <div class="text-muted">Matches</div>
            <div class="fs-3">${overview.matches}</div>
        </div></div></div>
    </div>`;
}

function adminTabsHtml(activeSection) {
    const sections = [
        ["users", "Benutzer"],
        ["jobs", "Stellenangebote"],
        ["matches", "Matches"]
    ];
    const tabs = sections.map(([section, label]) => {
        const style = section === activeSection ? "primary" : "outline-secondary";
        return button(label, "admin-section", section, style);
    }).join("");
    return `<div class="d-flex flex-wrap gap-2 mb-3">${tabs}</div>`;
}

function adminUserRowHtml(user) {
    let action = "–";
    if (user.id !== state.user.id) {
        const label = user.active ? "Deaktivieren" : "Aktivieren";
        action = button(label, "admin-user", user.id, "outline-secondary", `data-active="${!user.active}"`);
    }
    return `<tr>
        <td>${text(user.username)}<div class="small text-muted">${text(user.email)}</div></td>
        <td>${text(user.role)}</td>
        <td>${user.active ? "Aktiv" : "Inaktiv"}</td>
        <td>${action}</td>
    </tr>`;
}

function adminJobRowHtml(job) {
    const label = job.active ? "Deaktivieren" : "Aktivieren";
    const action = button(label, "admin-job", job.id, "outline-secondary", `data-active="${!job.active}"`);
    return `<tr>
        <td>${text(job.title)}<div class="small text-muted">${text(job.companyName)}</div></td>
        <td>${text(job.location)}</td>
        <td>${job.active ? "Aktiv" : "Inaktiv"}</td>
        <td>${action}</td>
    </tr>`;
}

function adminMatchRowHtml(match) {
    return `<tr>
        <td>${text(match.jobOffer.title)}</td>
        <td>${text(match.employee.username)}</td>
        <td>${text(match.employer.username)}</td>
        <td>${date(match.createdAt)}</td>
    </tr>`;
}

function adminTableHtml(section, page) {
    if (page.content.length === 0) return empty("Keine Einträge vorhanden.");

    let headers;
    let renderRow;
    if (section === "users") {
        headers = ["Benutzer", "Rolle", "Status", "Aktion"];
        renderRow = adminUserRowHtml;
    } else if (section === "jobs") {
        headers = ["Stelle", "Standort", "Status", "Aktion"];
        renderRow = adminJobRowHtml;
    } else {
        headers = ["Stelle", "Arbeitnehmer", "Arbeitgeber", "Datum"];
        renderRow = adminMatchRowHtml;
    }

    const headerCells = headers.map(label => `<th scope="col">${label}</th>`).join("");
    const rows = page.content.map(renderRow).join("");
    return `<div class="table-responsive">
        <table class="table table-striped align-middle">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>${pageControls(`admin-${section}`, page)}`;
}

function adminMatchSearchFormHtml(query, searching) {
    return `<form id="admin-match-search" class="row g-2 align-items-end mb-3" role="search">
        <div class="col-md-8">
            <label class="form-label" for="admin-match-query">Arbeitnehmer oder Arbeitgeber suchen</label>
            <input class="form-control" id="admin-match-query" name="query" type="search"
                maxlength="254" required value="${escapeHtml(query)}" placeholder="Benutzername oder E-Mail">
        </div>
        <div class="col-md-4 d-flex gap-2">
            <button class="btn btn-primary" type="submit">Suchen</button>
            ${searching ? `<button class="btn btn-outline-secondary" id="admin-match-clear" type="button">Zurücksetzen</button>` : ""}
        </div>
    </form>`;
}

function adminMatchGroupHtml(title, groups, otherRole, otherRoleLabel) {
    const cards = groups.map(group => {
        const rows = group.matches.map(match => `<tr>
            <td>${text(match.jobOffer.title)}</td>
            <td>${text(match[otherRole].username)}</td>
            <td>${text(match.status)}</td>
            <td>${date(match.createdAt)}</td>
        </tr>`).join("");
        return `<div class="card mb-3"><div class="card-body">
            <h3 class="h6 mb-1">${text(group.user.username)}</h3>
            <p class="small text-muted">${text(group.user.email)} · ${group.matches.length} Matches</p>
            <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                    <thead><tr>
                        <th scope="col">Stelle</th>
                        <th scope="col">${otherRoleLabel}</th>
                        <th scope="col">Status</th>
                        <th scope="col">Datum</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div></div>`;
    }).join("");
    return `<section class="mb-4"><h2 class="h5">${title} (${groups.length})</h2>${cards}</section>`;
}

function adminMatchSearchResultsHtml(results) {
    if (results.employees.length === 0 && results.employers.length === 0) {
        return empty("Keine Matches für diese Suche gefunden.");
    }
    const employees = adminMatchGroupHtml("Arbeitnehmer", results.employees, "employer", "Arbeitgeber");
    const employers = adminMatchGroupHtml("Arbeitgeber", results.employers, "employee", "Arbeitnehmer");
    return employees + employers;
}

async function renderAdmin() {
    const section = state.filters.adminSection || "users";
    const searchQuery = state.filters.adminMatchSearch || "";
    const searchingMatches = section === "matches" && searchQuery.length > 0;

    // Search returns grouped matches; the regular tab endpoints return a page.
    let dataRequest;
    if (searchingMatches) {
        const params = new URLSearchParams({query: searchQuery});
        dataRequest = api(`/api/admin/matches/search?${params}`);
    } else {
        const pageNumber = state.pages[`admin-${section}`] || 0;
        dataRequest = api(`/api/admin/${section}?page=${pageNumber}&size=10`);
    }
    const [overview, data] = await Promise.all([
        api("/api/admin/overview"),
        dataRequest
    ]);

    let resultsHtml;
    if (searchingMatches) {
        resultsHtml = adminMatchSearchResultsHtml(data);
    } else {
        resultsHtml = adminTableHtml(section, data);
    }

    let searchFormHtml = "";
    if (section === "matches") {
        searchFormHtml = adminMatchSearchFormHtml(searchQuery, searchingMatches);
    }

    app.innerHTML = heading("Administration")
        + adminOverviewHtml(overview)
        + adminTabsHtml(section)
        + searchFormHtml
        + resultsHtml;

    const searchForm = document.getElementById("admin-match-search");
    if (searchForm) {
        searchForm.addEventListener("submit", event => {
            event.preventDefault();
            state.filters.adminMatchSearch = event.currentTarget.elements.query.value.trim();
            renderAdmin().catch(showError);
        });
    }

    const clearButton = document.getElementById("admin-match-clear");
    if (clearButton) {
        clearButton.addEventListener("click", () => {
            state.filters.adminMatchSearch = "";
            state.pages["admin-matches"] = 0;
            renderAdmin().catch(showError);
        });
    }
}

document.addEventListener("click", async event => {
    // Screens replace app.innerHTML, so one listener on document handles their new buttons too.
    const link = event.target.closest("a[data-link]");
    if (link) { event.preventDefault(); navigate(link.pathname); return; }
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const {action, id, decision, active, page} = control.dataset;
    try {
        if (action === "logout") {
            try { await api("/api/auth/logout", {method: "POST"}); } catch { /* local logout still works */ }
            clearSession(); navigate("/login");
        } else if (action === "add-experience") {
            document.getElementById("experience-list").insertAdjacentHTML("beforeend", experienceRow());
        } else if (action === "remove-experience") {
            control.closest(".experience-row").remove();
        } else if (action === "page") {
            state.pages[id] = Number(page); render();
        } else if (action === "edit-job") {
            state.editingJob = id; renderManageJobs(); window.scrollTo(0, 0);
        } else if (action === "cancel-edit") {
            state.editingJob = null; renderManageJobs();
        } else if (action === "toggle-job") {
            await api(`/api/jobs/${id}/active`, {method: "PATCH", body: json({active: active === "true"})});
            showMessage("Status geändert."); renderManageJobs();
        } else if (action === "swipe-job") {
            const result = await api(`/api/swipes/job/${id}`, {method: "POST", body: json({decision})});
            // The backend decides whether this like completed a two-sided match.
            showMessage(result.matchCreated ? "Match! Die andere Seite hat ebenfalls Interesse." : "Bewertung gespeichert.");
        } else if (action === "swipe-candidate") {
            // Candidate swipes include the chosen job ID because an employer may have several jobs.
            const result = await api(`/api/swipes/profile/${id}`, {method: "POST", body: json({jobOfferId: Number(state.selectedJob), decision})});
            showMessage(result.matchCreated ? "Match! Die andere Seite hat ebenfalls Interesse." : "Bewertung gespeichert.");
        } else if (action === "admin-section") {
            state.filters.adminSection = id; await renderAdmin();
        } else if (action === "admin-user" || action === "admin-job") {
            await api(`/api/admin/${action === "admin-user" ? "users" : "jobs"}/${id}/active`, {method: "PATCH", body: json({active: active === "true"})});
            showMessage("Status geändert."); await renderAdmin();
        }
    } catch (error) { showError(error); }
});
window.addEventListener("popstate", render);
// On refresh, ask the backend whether the stored token still belongs to an active user.
(async () => {
    if (state.token) {
        try { state.user = await api("/api/auth/me"); sessionStorage.setItem("jobswiperUser", json(state.user)); }
        catch (error) { if (error.status !== 401) showError(error); }
    }
    render();
})();
