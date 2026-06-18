//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

"use strict";

//
// Globals
//

export let pathIds: {
    eventName: string|null,
    eventId: number|null,
    incidentNumber: number|null,
    reportNumber: number|null,
    visitNumber: number|null,
} = {
    eventName: null,
    eventId: null,
    incidentNumber: null,
    reportNumber: null,
    visitNumber: null,
};

export let eventAccess: AuthInfoEventAccess|null = null;

const accessTokenKey = "access_token";
const accessTokenRefreshAfterKey = "access_token_refresh_after";

const incidentsPreferredStateKey = "preferred_incidents_state";
const preferredTableRowsPerPageKey = "preferred_table_rows_per_page";
const visitsPreferredStatusKey = "preferred_visits_status";


//
// HTML encoding
//

export const integerRegExp: RegExp = /^\d+$/;

function idsFromPath(): {
    eventName: string|null,
    eventId: number|null,
    incidentNumber:number|null,
    reportNumber: number|null,
    visitNumber:number|null,
} {
    const splits = window.location.pathname.split("/");

    // e.g. given splits of [dog, cat, emu] and s = "cat",
    // this will return "emu"
    function tokenAfter(s: string): string|null {
        const index = splits.indexOf(s);
        if (index < 0) {
            return null;
        }
        if (index >= splits.length-1) {
            return null;
        }
        if (splits[index+1] === "") {
            return null;
        }
        return splits[index+1]??null;
    }
    return {
        eventName: tokenAfter("events"),
        eventId: null,
        incidentNumber: parseInt10(tokenAfter("incidents")),
        reportNumber: parseInt10(tokenAfter("reports")),
        visitNumber: parseInt10(tokenAfter("visits")),
    };
}

//
// URL substitution
//
export function urlReplace(url: string): string {
    const event: string|null = pathIds.eventName;
    if (event) {
        url = url.replace("<event_id>", event);
    }
    return url;
}


//
// Arrays
//

// Build an array from a range.
export function range(start: number, end: number, step?: number|null): number[] {
    if (step == null) {
        step = 1;
    } else if (step === 0) {
        throw new RangeError("step = 0");
    }

    return Array(end - start)
        .join("a")
        .split("a")
        .map(function(_val: string, i: number) { return (i * step) + start;} )
        ;
}


export function compareJournalEntries(a: JournalEntry, b: JournalEntry): number {
    if (a.created! < b.created!) { return -1; }
    if (a.created! > b.created!) { return  1; }

    if (a.system_entry && ! b.system_entry) { return -1; }
    if (! a.system_entry && b.system_entry) { return  1; }

    if (a.text! < b.text!) { return -1; }
    if (a.text! > b.text!) { return  1; }

    return 0;
}


//
// Request making
//

async function maybeRefreshAuth(): Promise<void> {
    if (getAccessToken()) {
        if ((refreshTokenAfter()??0) < new Date().getTime()) {
            const {json, err} = await fetchNoThrow<AuthRefreshResponse>(url_authRefresh, {body: JSON.stringify({})});
            if (err != null || json == null) {
                clearLocalStorage();
                clearSessionStorage();
            } else {
                setAccessToken(json.token);
                setRefreshTokenBy(json.expires_unix_ms);
                console.log("Refreshed access token");
            }
        }
    }
    return
}

export async function fetchNoThrow<T>(url: string, init: RequestInit|null): Promise<FetchRes<T>> {
    if (url !== url_authRefresh) {
        await maybeRefreshAuth();
    }

    if (init == null) {
        init = {};
    }
    init.headers = new Headers(init.headers);
    // This is kind of a lie. Not all fetches in IMS expect to get JSON.
    // Can/should this just be removed?
    init.headers.set("Accept", "application/json");
    const tok = getAccessToken();
    if (tok) {
        init.headers.set("Authorization", "Bearer " + tok);
    }
    if (init.body != null) {
        init.method = init.method || "POST";

        if (init.body.constructor.name === "FormData") {
            let size = 0;
            const fd = init.body as FormData;
            for(const [k,v] of fd.entries()) {
                size += k.length;
                if (v instanceof Blob) {
                    size += v.size;
                } else {
                    size += v.length;
                }
            }
            // don't JSONify, don't set a Content-Type (fetch does it automatically for FormData)
        } else {
            // otherwise assume body is supposed to be json
            init.headers.set("Content-Type", "application/json");
            if (typeof init.body !== "string") {
                init.body = JSON.stringify(init.body);
            }
        }
    }
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (err: unknown) {
        if (err instanceof Error) {
            return {resp: null, json: null, err: err.message};
        }
        throw err;
    }
    let err: string|null = null;
    if (!response.ok) {
        err = `${response.statusText} (${response.status})`;
        if (response.headers.get("content-type") === "application/problem+json") {
            let problem: Problem = await response.json();
            err = `${problem.detail??""} (HTTP ${response.status})`;
        }
    }
    let json: T|null = null;
    if (response.headers.get("content-type") === "application/json") {
        json = await response.json();
    }
    return {resp: response, json: json, err: err};
}


//
// Generic string formatting
//

// Pad a string representing an integer to two digits.
export function padTwo(value: number|string|null|undefined): string {
    if (value == null) {
        return "?";
    }
    return value.toString().padStart(2, "0");
}


// Convert a minute (0-60) into a value used by IMS form inputs.
// That is: round to the nearest multiple of 5 and pad to two digits.
export function normalizeMinute(minute: number): string {
    minute = Math.round(minute / 5) * 5;
    while (minute > 60) {
        minute -= 60;
    }
    return padTwo(minute);
}


// Apparently some implementations of Number.parseInt don't reliably use base
// 10 by default (eg. when encountering leading zeroes).
//
// This takes something like a string, and returns an integer if it can be parsed
// as an integer, or null otherwise (unlike parseInt!).
export function parseInt10(stringInt: string|null|undefined): number|null {
    if (stringInt == null) {
        return null;
    }
    const int = Number.parseInt(stringInt, 10);
    if (isNaN(int)) {
        return null;
    }
    return int;
}


//
// Elements
//

// Create a <time> element from a date.
function timeElement(date: Date): HTMLTimeElement {
    const timeStampContainer = document.createElement("time");
    timeStampContainer.setAttribute("datetime", date.toISOString());
    timeStampContainer.textContent = longFormatDate(date);
    return timeStampContainer;
}

// Disable an element
function disable(elements: Iterable<Element>) {
    for (const e of elements) {
        e.setAttribute("disabled", "");
    }
}


// Enable an element
function enable(elements: Iterable<Element>) {
    for (const e of elements) {
        e.removeAttribute("disabled");
    }
}


// Disable editing for an element
export function disableEditing() {
    disable(document.querySelectorAll(".form-control"));
    disable(document.querySelectorAll(".form-control-lite"));
    // these forms don't actually exist
    // disable(document.querySelectorAll("#entries-form input,select,textarea,button"));
    // disable(document.querySelectorAll("#attach-file-form input,select,textarea,button"));
    enable(document.querySelectorAll("input[type=search]"));  // Don't disable search fields
    document.documentElement.classList.add("no-edit");
}


// Enable editing for an element
export function enableEditing() {
    enable(document.querySelectorAll(".form-control"));
    enable(document.querySelectorAll(".form-control-lite"));
    // these forms don't actually exist
    // enable(document.querySelectorAll("#entries-form input,select,textarea,button"));
    // enable(document.querySelectorAll("#attach-file-form :input,select,textarea,button"));
    document.documentElement.classList.remove("no-edit");
}

export function hide(selector: string): void {
    document.querySelectorAll(selector).forEach((el) => {
        el.classList.add("hidden");
    })
}

export function unhide(selector: string): void {
    document.querySelectorAll(selector).forEach((el) => {
        el.classList.remove("hidden");
    })
}

// Add an error indication to a control
export function controlHasError(element: HTMLElement, clearTimeout: number = 5000) {
    element.classList.remove("is-valid");
    element.classList.add("is-invalid");
    setTimeout((): void=>{
        controlClear(element);
    }, clearTimeout);
}


// Add a success indication to a control
export function controlHasSuccess(element: HTMLElement, clearTimeout: number = 1000) {
    element.classList.remove("is-invalid");
    element.classList.add("is-valid");
    setTimeout((): void=>{
        controlClear(element);
    }, clearTimeout);
}


// Clear error/success indication from a control
function controlClear(element: HTMLElement) {
    element.classList.remove("is-invalid");
    element.classList.remove("is-valid");
}


//
// Initialize the page. This should be called by each page after loading the DOM.
//
export async function commonPageInit(): Promise<PageInitResult> {
    detectTouchDevice();
    let authInfo: AuthInfo|null = null;
    pathIds = idsFromPath();
    {
        const {json, resp, err} = await getAuthInfo();
        if (err != null || json == null) {
            console.log(`Failed to fetch auth info: ${err}, ${resp?.status}`);
            setErrorMessage(`Failed to fetch auth info: ${err}, ${resp?.status}`);
            return {
                authInfo: {authenticated: false},
                eventDatas: Promise.resolve(null),
            };
        }
        authInfo = json;
    }
    let eds: Promise<EventData[]|null> = Promise.resolve(null);
    if (authInfo.authenticated) {
        eventAccess = authInfo.event_access?.[pathIds.eventName!]??null;
        pathIds.eventId = eventAccess?.event_id??null;
        eds = fetchNoThrow<EventData[]>(url_events, null).then(
            result => {
                if (result.err != null || result.json == null) {
                    console.log(`Failed to fetch events: ${result.err}`);
                    return null;
                }
                renderNavEvents(result.json);
                return result.json;
            }
        );
    }
    renderCommonPageItems(authInfo);
    return {authInfo: authInfo, eventDatas: eds};
}

export async function getAuthInfo(): Promise<FetchRes<AuthInfo>> {
    const url = url_auth + (pathIds.eventName ? `?event_id=${pathIds.eventName}` : "");
    return await fetchNoThrow<AuthInfo>(url, null);
}

export async function redirectToLogin(): Promise<void> {
    // This clears the refresh cookie
    await fetch(url_logout);
    clearLocalStorage();
    console.log("Logged out. Redirecting to login page")
    window.location.replace(`${url_login}?o=${encodeURIComponent(window.location.pathname)}`);
}

function renderCommonPageItems(authInfo: AuthInfo): void {
    if (authInfo.authenticated) {
        unhide(".if-logged-in");
        hide(".if-not-logged-in");
        document.querySelectorAll(".logged-in-user").forEach(e => {
            e.textContent = authInfo.user;
        });
        if (authInfo.admin) {
            unhide(".if-admin");
        }
    }
    if (!authInfo.authenticated) {
        hide(".if-logged-in");
        unhide(".if-not-logged-in");
        hide(".if-admin");
    }

    // Set the active event in the navbar, show "Incidents" and "Report" buttons
    const event: string|null = pathIds.eventName;
    if (event != null) {
        const eventLabel = document.getElementById("nav-event-id")!;
        eventLabel.textContent = event;
        eventLabel.classList.add("active-event");

        const activeEventIncidents = document.getElementById("active-event-incidents") as HTMLAnchorElement|null;
        if (activeEventIncidents != null) {
            activeEventIncidents.href = urlReplace(url_viewIncidents);
            activeEventIncidents.classList.remove("hidden");

            if (window.location.pathname.startsWith(urlReplace(url_viewIncidents))) {
                activeEventIncidents.classList.add("active");
            }
        }

        const activeEventFRs = document.getElementById("active-event-reports") as HTMLAnchorElement|null;
        if (activeEventFRs != null) {
            activeEventFRs.href = urlReplace(url_viewReports);
            activeEventFRs.classList.remove("hidden");

            if (window.location.pathname.startsWith(urlReplace(url_viewReports))) {
                activeEventFRs.classList.add("active");
            }
        }

        const activeEventVisits = document.getElementById("active-event-visits") as HTMLAnchorElement|null;
        if (activeEventVisits != null) {
            activeEventVisits.href = urlReplace(url_viewVisits);
            activeEventVisits.classList.remove("hidden");

            if (window.location.pathname.startsWith(urlReplace(url_viewVisits))) {
                activeEventVisits.classList.add("active");
            }
        }

        // People is admin-only for now (the refine-later seam in 62-people-event-nav.md):
        // reveal it only when an event is active AND the viewer is an admin.
        const activeEventPeople = document.getElementById("active-event-people") as HTMLAnchorElement|null;
        if (activeEventPeople != null && authInfo.authenticated && authInfo.admin) {
            activeEventPeople.href = urlReplace(url_viewPeople);
            activeEventPeople.classList.remove("hidden");

            if (window.location.pathname.startsWith(urlReplace(url_viewPeople))) {
                activeEventPeople.classList.add("active");
            }
        }

        // Dashboard is admin-only for now (the refine-later seam in 70-dashboards.md):
        // same reveal rule as People — only when an event is active AND admin.
        const activeEventDashboard = document.getElementById("active-event-dashboard") as HTMLAnchorElement|null;
        if (activeEventDashboard != null && authInfo.authenticated && authInfo.admin) {
            activeEventDashboard.href = urlReplace(url_viewDashboard);
            activeEventDashboard.classList.remove("hidden");

            if (window.location.pathname.startsWith(urlReplace(url_viewDashboard))) {
                activeEventDashboard.classList.add("active");
            }
        }
    }
}

function renderNavEvents(eds: EventData[]): void {
    const eventIds: string[] = eds.map((ed) => ed.name);
    eventIds.sort((a, b) => b.localeCompare(a));
    const navEvents = document.getElementById("nav-events") as HTMLUListElement;
    for (const id of eventIds) {
        const anchor = document.createElement("a");
        anchor.textContent = id;
        anchor.classList.add("dropdown-item");
        anchor.href = url_viewIncidents.replace("<event_id>", id);
        const li = document.createElement("li");
        li.append(anchor);
        navEvents.append(li);
    }
}


//
// Touch device detection
//

// Add .touch or .no-touch class to top-level element if the browser is or is
// not on a touch device, respectively.
export function detectTouchDevice(): void {
    if ("ontouchstart" in document.documentElement) {
        document.documentElement.classList.add("touch");
    } else {
        document.documentElement.classList.add("no-touch");
    }
}


//
// Controls
//

// Select an option element with a given value from a given select element.
export function selectOptionWithValue(select: HTMLSelectElement, value: string|null) {
    for (const opt of select.options) {
        opt.selected = (opt.value === value);
    }
}


//
// Incident data
//


// Look up a state's name given its ID.
function stateNameFromID(stateID: IncidentState): string {
    switch (stateID) {
        case "new"       : return "New";
        case "on_hold"   : return "On Hold";
        case "dispatched": return "Dispatched";
        case "on_scene"  : return "On Scene";
        case "closed"    : return "Closed";
        case "null"      :
            console.warn(`Unknown incident state ID: ${stateID}`);
            return "Unknown";
        default:
            console.warn(`Unknown incident state ID: ${stateID satisfies never}`);
            return "Unknown";
    }
}


// Look up a state's sort key given its ID.
function stateSortKeyFromID(stateID: IncidentState): number|undefined {
    switch (stateID) {
        case "new"       : return 1;
        case "on_hold"   : return 2;
        case "dispatched": return 3;
        case "on_scene"  : return 4;
        case "closed"    : return 5;
        case "null"      :
            console.warn(`Unknown incident state ID: ${stateID}`);
            return undefined;
        default:
            console.warn(`Unknown incident state ID: ${stateID satisfies never}`);
            return undefined;
    }
}

// Look up an outcome's display name given its ID. "" (no outcome recorded)
// renders blank.
export function outcomeNameFromID(outcomeID: IncidentOutcome): string {
    switch (outcomeID) {
        case ""                            : return "";
        case "information_only"            : return "Information Only";
        case "resolved_on_scene"           : return "Resolved On Scene";
        case "referred_to_coordinator"     : return "Referred to Coordinator";
        case "referred_to_management"      : return "Referred to Management";
        case "referred_to_community_support": return "Referred to Community Support";
        case "referred_to_mediation"       : return "Referred to Mediation";
        case "follow_up_required"          : return "Follow-Up Required";
        case "no_action_needed"            : return "No Action Needed";
        default:
            console.warn(`Unknown incident outcome ID: ${outcomeID satisfies never}`);
            return "Unknown";
    }
}

// key is person handle
export type PersonnelMap = Record<string, Personnel>;

export async function fetchPersonnel(): Promise<{personnel: PersonnelMap|null, err: string|null}> {
    const {json, err} = await fetchNoThrow<Personnel[]>(urlReplace(url_personnel + "?event_id=<event_id>"), null);
    if (err != null) {
        const message = `Failed to load personnel: ${err}`;
        console.error(message);
        setErrorMessage(message);
        return {personnel: null, err: message};
    }
    const personnel: PersonnelMap = {};
    for (const record of json!) {
        switch (record.status) {
            case "active":
            case "alpha":
            case "inactive":
            case "inactive extension":
            case "prospective":
                personnel[record.handle] = record;
                break
            case "auditor":
                // Don't add auditors to the personnel list.
                break;
            default:
                console.log(`unrecognized status: ${record.status satisfies never}`);
                break;
        }
    }
    return {personnel: personnel, err: null};
}


//
// Person search + search-first combobox (see docs/plans/51-people-registry.md).
// Replaces the native <datalist> person picker so handle-less registry people are
// findable and a "create new person" fallback can be offered inline.
//

// personDisplayLabel resolves a person's display label as COALESCE(name, handle).
export function personDisplayLabel(p: {name?: string|null|undefined, handle?: string|null|undefined}): string {
    if (p.name != null && p.name.trim() !== "") {
        return p.name;
    }
    return p.handle ?? "";
}

// searchPersonnel queries the typeahead endpoint, scoped to an event so each hit
// carries that event's wristband + participation type and wristbands are searchable.
export async function searchPersonnel(query: string, eventName: string): Promise<PersonSearchResult[]> {
    const params = new URLSearchParams({q: query, event: eventName});
    const {json, err} = await fetchNoThrow<PersonSearchResult[]>(
        urlReplace(url_personnel) + "?" + params.toString(), null);
    if (err != null || json == null) {
        if (err != null) {
            console.error(`Failed to search personnel: ${err}`);
        }
        return [];
    }
    return json;
}

// createRegistryPerson creates a minimal (no-login) registry person from a field
// flow and returns it (with its new person_id) for immediate attach.
export async function createRegistryPerson(name: string, eventName: string): Promise<PersonSearchResult|null> {
    const {json, err} = await fetchNoThrow<PersonSearchResult>(urlReplace(url_personnel), {
        method: "POST",
        body: JSON.stringify({name: name, event: eventName}),
    });
    if (err != null || json == null) {
        setErrorMessage(`Failed to create person: ${err}`);
        return null;
    }
    return json;
}

// openQuickAddPersonModal shows the shared QuickAddPersonModal (web/template/quickaddperson.templ)
// pre-filled with the typed text, lets the user supply handle/email/password/onsite and
// (when an event is named) wristband/participation, then creates the person and resolves
// with it. Resolves null if the user cancels or creation fails (the error is shown inline
// in the modal, which stays open so they can retry). Pages must include @QuickAddPersonModal().
export function openQuickAddPersonModal(prefillName: string, eventName: string): Promise<PersonSearchResult|null> {
    const modalEl = typedElement("quickAddPersonModal", HTMLElement);
    const nameEl = typedElement("quick_add_person_name", HTMLInputElement);
    const handleEl = typedElement("quick_add_person_handle", HTMLInputElement);
    const emailEl = typedElement("quick_add_person_email", HTMLInputElement);
    const passwordEl = typedElement("quick_add_person_password", HTMLInputElement);
    const onsiteEl = typedElement("quick_add_person_onsite", HTMLInputElement);
    const eventSectionEl = typedElement("quick_add_person_event_section", HTMLElement);
    const eventNameEl = typedElement("quick_add_person_event_name", HTMLElement);
    const wristbandEl = typedElement("quick_add_person_wristband", HTMLInputElement);
    const participationEl = typedElement("quick_add_person_participation", HTMLSelectElement);
    const errorEl = typedElement("quick_add_person_error", HTMLElement);
    const submitEl = typedElement("quick_add_person_submit", HTMLButtonElement);

    // Reset the form to a clean state, seeded with the typed text.
    nameEl.value = prefillName;
    handleEl.value = "";
    emailEl.value = "";
    passwordEl.value = "";
    onsiteEl.checked = false;
    wristbandEl.value = "";
    participationEl.value = "";
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
    // Per-event fields only make sense when scoped to an actual event.
    eventSectionEl.classList.toggle("hidden", !eventName);
    eventNameEl.textContent = eventName;

    const modal = bsModal(modalEl);

    return new Promise<PersonSearchResult|null>((resolve): void => {
        let settled = false;

        function showError(msg: string): void {
            errorEl.textContent = msg;
            errorEl.classList.remove("hidden");
        }

        function cleanup(): void {
            submitEl.removeEventListener("click", onSubmit);
            modalEl.removeEventListener("hidden.bs.modal", onHidden);
        }

        // Dismiss (Cancel / × / backdrop) resolves null unless a create already settled.
        function onHidden(): void {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(null);
        }

        async function onSubmit(): Promise<void> {
            const name = nameEl.value.trim();
            const handle = handleEl.value.trim();
            if (!name && !handle) {
                showError("A name or handle is required.");
                return;
            }
            const body: Record<string, unknown> = {
                name: name,
                handle: handle,
                email: emailEl.value.trim(),
                password: passwordEl.value,
                onsite: onsiteEl.checked,
            };
            if (eventName) {
                body["event"] = eventName;
                body["wristband"] = wristbandEl.value.trim();
                body["participation_type"] = participationEl.value;
            }
            submitEl.disabled = true;
            const {json, err} = await fetchNoThrow<PersonSearchResult>(urlReplace(url_personnel), {
                body: JSON.stringify(body),
            });
            submitEl.disabled = false;
            if (err != null || json == null) {
                showError(`Failed to create person: ${err ?? "no response"}`);
                return;
            }
            settled = true;
            cleanup();
            modal.hide();
            resolve(json);
        }

        submitEl.addEventListener("click", onSubmit);
        modalEl.addEventListener("hidden.bs.modal", onHidden);
        modal.show();
    });
}

export type PersonComboboxConfig = {
    // The text input the user types into.
    input: HTMLInputElement;
    // An (initially empty, "hidden"-classed) container the results dropdown renders into.
    results: HTMLElement;
    // Event name used to scope the search and any inline create.
    eventName: string;
    // Whether to offer the "create new person" fallback when nothing matches.
    allowCreate: boolean;
    // Called with the picked (or freshly created) person.
    onPick: (person: PersonSearchResult) => void | Promise<void>;
    // Optional override for the "create new person" path. When set, it's called
    // with the typed text and must resolve to the created person (or null if the
    // user cancelled / it failed). Pages that include the QuickAddPersonModal pass
    // openQuickAddPersonModal here so the user can fill in handle/email/wristband
    // before creating. When omitted, a name-only inline create is used.
    onCreate?: (typedName: string) => Promise<PersonSearchResult|null>;
};

// setupPersonCombobox turns a text input + a results container into a search-first
// person picker: it debounces queries to the typeahead endpoint, lists matches to
// pick from, and — only when nothing matches — offers "Create new person" (if
// allowCreate). This replaces the native <input list=datalist> and delivers the
// visible dropdown affordance round-2 feedback 6d.3 asked for.
export function setupPersonCombobox(cfg: PersonComboboxConfig): void {
    type Row = {person?: PersonSearchResult; createName?: string};
    let rows: Row[] = [];
    let activeIndex = -1;
    let seq = 0;
    let timer = 0;

    function closeList(): void {
        cfg.results.replaceChildren();
        cfg.results.classList.add("hidden");
        rows = [];
        activeIndex = -1;
    }

    function highlight(idx: number): void {
        activeIndex = idx;
        Array.from(cfg.results.children).forEach((c: Element, i: number): void => {
            c.classList.toggle("active", i === idx);
        });
    }

    function renderRows(matches: PersonSearchResult[], typed: string): void {
        const lowerTyped = typed.toLowerCase();
        const exact = matches.some((m: PersonSearchResult): boolean =>
            personDisplayLabel(m).toLowerCase() === lowerTyped || (m.handle??"").toLowerCase() === lowerTyped);
        rows = matches.map((p: PersonSearchResult): Row => ({person: p}));
        if (cfg.allowCreate && !exact) {
            rows.push({createName: typed});
        }
        cfg.results.replaceChildren();
        if (rows.length === 0) {
            closeList();
            return;
        }
        rows.forEach((row: Row, idx: number): void => {
            const item: HTMLButtonElement = document.createElement("button");
            item.type = "button";
            item.classList.add("list-group-item", "list-group-item-action", "py-1", "text-start");
            if (row.person != null) {
                const label: HTMLSpanElement = document.createElement("span");
                label.textContent = personDisplayLabel(row.person);
                item.append(label);
                if (row.person.wristband) {
                    const wb: HTMLSpanElement = document.createElement("span");
                    wb.classList.add("badge", "text-bg-secondary", "ms-2");
                    wb.textContent = row.person.wristband;
                    item.append(wb);
                }
                if (row.person.participation_type) {
                    const pt: HTMLSpanElement = document.createElement("span");
                    pt.classList.add("badge", "text-bg-light", "ms-2");
                    pt.textContent = row.person.participation_type;
                    item.append(pt);
                }
            } else {
                item.classList.add("fst-italic");
                item.textContent = `Create new person “${row.createName}”`;
            }
            // mousedown (not click) so selection fires before the input's blur hides the list.
            item.addEventListener("mousedown", (e: MouseEvent): void => {
                e.preventDefault();
                void choose(idx);
            });
            cfg.results.append(item);
        });
        cfg.results.classList.remove("hidden");
        highlight(0);
    }

    async function choose(idx: number): Promise<void> {
        const row: Row|undefined = rows[idx];
        closeList();
        if (row == null) {
            return;
        }
        cfg.input.value = "";
        if (row.person != null) {
            await cfg.onPick(row.person);
        } else if (row.createName != null) {
            const created = cfg.onCreate != null
                ? await cfg.onCreate(row.createName)
                : await createRegistryPerson(row.createName, cfg.eventName);
            if (created != null) {
                await cfg.onPick(created);
            }
        }
    }

    async function runSearch(): Promise<void> {
        const typed: string = cfg.input.value.trim();
        // D-P4: require >= 2 chars before searching.
        if (typed.length < 2) {
            closeList();
            return;
        }
        const mySeq: number = ++seq;
        const matches: PersonSearchResult[] = await searchPersonnel(typed, cfg.eventName);
        if (mySeq !== seq) {
            return; // a newer keystroke superseded this query
        }
        renderRows(matches, typed);
    }

    cfg.input.setAttribute("autocomplete", "off");
    cfg.input.addEventListener("input", (): void => {
        window.clearTimeout(timer);
        timer = window.setTimeout((): void => void runSearch(), 200);
    });
    cfg.input.addEventListener("keydown", (e: KeyboardEvent): void => {
        if (cfg.results.classList.contains("hidden")) {
            return;
        }
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                highlight(Math.min(activeIndex + 1, rows.length - 1));
                break;
            case "ArrowUp":
                e.preventDefault();
                highlight(Math.max(activeIndex - 1, 0));
                break;
            case "Enter":
                e.preventDefault();
                if (activeIndex >= 0) {
                    void choose(activeIndex);
                }
                break;
            case "Escape":
                closeList();
                break;
        }
    });
    // Delay close so a result's mousedown is handled before the list hides.
    cfg.input.addEventListener("blur", (): void => {
        window.setTimeout(closeList, 150);
    });
}


// Return the state ID for a given incident.
export function stateForIncident(incident: Incident): IncidentState {
    // Data from 2014+ should have incident.state set.
    if (incident.state !== undefined) {
        return incident.state || 'null';
    }

    console.warn("Unknown state for incident: " + incident);
    return 'null';
}


// Return a summary for a given incident.
export function summarizeIncidentOrReport(ifr: Incident|Report): string {
    if (ifr.summary) {
        return ifr.summary;
    }

    // Get the first line of the first journal entry.
    for (const journalEntry of ifr.journal_entries??[]) {
        if (journalEntry.system_entry) {
            // Don't use a system-generated entry in the summary
            continue;
        }

        const lines = journalEntry.text!.split("\n");
        for (const line of lines) {
            if (line) {
                return line;
            }
        }
    }
    return "";
}


// Get author for incident
function incidentAuthor(incident: Incident): string {
    for (const entry of incident.journal_entries??[]) {
        if (entry.author) {
            return entry.author;
        }
    }

    return "(none)";
}


// Get author for report
function reportAuthor(report: Report): string {
    return incidentAuthor(report);
}


// Render incident as a string
export function incidentAsString(incident: Incident): string {
    if (incident.number == null) {
        return `New Incident`;
    }
    return `#${incident.number} ${summarizeIncidentOrReport(incident)}`;
}


// Render report as a string
export function reportAsString(report: Report): string {
    if (report.number == null) {
        return `New Report`;
    }
    return `Report #${report.number} (${reportAuthor(report)}): ${summarizeIncidentOrReport(report)}`;
}

export function visitAsString(s: Visit): string {
    if (s.number == null) {
        return "New Visit";
    }
    const guest = personDisplayLabel({name: s.guest_name, handle: s.guest_handle}) || s.guest_legal_name || "";
    return `VS #${s.number}: ${guest}`;
}

// Return all user-entered journal text for a given incident as a single string.
export function reportTextFromIncident(
    incidentFROrVisit: Incident|Report|Visit,
    eventReports?: ReportsByNumber,
    eventVisits?: VisitsByNumber,
): string {
    const texts: string[] = [];

    if ("summary" in incidentFROrVisit) {
        texts.push(incidentFROrVisit.summary||"");
    }
    if ("guest_name" in incidentFROrVisit) {
        texts.push(incidentFROrVisit.guest_name||"");
    }
    if ("guest_legal_name" in incidentFROrVisit) {
        texts.push(incidentFROrVisit.guest_legal_name||"");
    }
    if ("guest_description" in incidentFROrVisit) {
        texts.push(incidentFROrVisit.guest_description||"");
    }

    for (const journalEntry of incidentFROrVisit.journal_entries??[]) {

        // Skip system entries
        if (journalEntry.system_entry) {
            continue;
        }

        if (journalEntry.text != null) {
            texts.push(journalEntry.text);
        }
    }

    // Incidents page loads all reports for the event
    if (eventReports != null && "reports" in incidentFROrVisit) {
        for (const reportNumber of incidentFROrVisit.reports??[]) {
            const report: Report = eventReports[reportNumber]!;
            const reportText = reportTextFromIncident(report);

            texts.push(reportText);
        }
    }
    // Incidents page also loads all visits for the event
    if (eventVisits != null && "visits" in incidentFROrVisit) {
        for (const visitNumber of incidentFROrVisit.visits??[]) {
            const visit: Visit = eventVisits[visitNumber]!;
            const reportText = reportTextFromIncident(visit);

            texts.push(reportText);
        }
    }

    return texts.join(" ");
}


// humanizeAreaSlug turns an area slug ("chela-mela") into a readable label
// ("Chela Mela") for display. The list view carries only the slug, not the
// area's editable display name.
function humanizeAreaSlug(slug: string): string {
    return slug
        .split("-")
        .filter(w => w.length > 0)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

// Return a short description for a given location.
function safeShortDescribeLocation(location: EventLocation): string {
    const area: string = location.area_slug ? humanizeAreaSlug(location.area_slug) : "";
    const booth: string = location.booth ? `Booth ${location.booth}` : "";
    let detail: string = DataTable.render.text().display(location.description);
    if (detail) {
        detail = `(${detail})`;
    }
    return [area, booth, detail].filter(s => s).join(" ");
}

// Return a short description for a given location.
function shortDescribeLocation(location: EventLocation): HTMLSpanElement {
    const sp = document.createElement("span");
    const appendSegment = (text: string): void => {
        if (sp.childNodes.length > 0) {
            sp.append(document.createElement("wbr"));
            sp.append(" ");
        }
        sp.append(text);
    };
    if (location.area_slug) {
        appendSegment(humanizeAreaSlug(location.area_slug));
    }
    if (location.booth) {
        appendSegment(`Booth ${location.booth}`);
    }
    if (location.description) {
        appendSegment(`(${location.description})`);
    }
    return sp;
}


//
// DataTables rendering
//

export type RenderValue = number|string|Node|null|undefined;

export function renderSortedSpan(strings: string[]): Node {
    const sortedCopy = strings.toSorted((a, b) => a.localeCompare(b));

    const sp = document.createElement("span");
    for (const [i, s] of sortedCopy.entries()) {
        if (i === sortedCopy.length - 1) {
            sp.append(s);
        } else {
            sp.append(s + ", ", document.createElement("wbr"));
        }
    }
    return sp;
}

export function renderIncidentNumber(incidentNumber: number|null, type: string, _incidentOrFROrVisit: any): RenderValue {
    switch (type) {
        case "display":
            if (incidentNumber == null) {
                return null;
            }
            const link = document.createElement("a");
            link.href = urlReplace(url_viewIncidentNumber).replace("<number>", incidentNumber.toString());
            link.text = incidentNumber.toString();
            return link;
        case "filter":
        case "type":
        case "sort":
        case undefined:
            return incidentNumber;
        default:
            return undefined
    }
}

export function renderReportNumber(reportNumber: number|null, type: string, _report: any): RenderValue {
    switch (type) {
        case "display":
            if (reportNumber == null) {
                return null;
            }
            const link = document.createElement("a");
            link.href = urlReplace(url_viewReportNumber).replace("<number>", reportNumber.toString());
            link.text = reportNumber.toString();
            return link;
        case "filter":
        case "type":
        case "sort":
        case undefined:
            return reportNumber;
        default:
            return undefined;
    }
}

export function renderVisitNumber(visitNumber: number|null, type: string, _visit: any): RenderValue {
    switch (type) {
        case "display":
            if (visitNumber == null) {
                return null;
            }
            const link = document.createElement("a");
            link.href = `${urlReplace(url_viewVisits)}/${visitNumber.toString()}`;
            link.text = visitNumber.toString();
            return link;
        case "filter":
        case "sort":
        case "type":
        case undefined:
            return visitNumber;
        default:
            return undefined;
    }
}

// e.g. "Wed, 8/28"
export const shortDate: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "numeric",
    day: "2-digit",
    // timeZone not specified; will use user's timezone
});

// e.g. "19:21"
export const shortTime: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    hour12: false,
    minute: "numeric",
    // timeZone not specified; will use user's timezone
});

// Returns something like "Sun, 2026-01-18 at 14:26:31 EST"
export function longFormatDate(date: Date|number): string {
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
        hour12: false
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(date);

    const partMap: Record<string, string> = {};
    parts.forEach(part => {
        partMap[part.type] = part.value;
    });

    return `${partMap['weekday']}, ${partMap['year']}-${partMap['month']}-${partMap['day']} at ${partMap['hour']}:${partMap['minute']}:${partMap['second']} ${partMap['timeZoneName']}`;
}

// returns something like -05:00
export function localTzOffset(d: Date): string|null {
    const parts = new Intl.DateTimeFormat(
        undefined, { timeZoneName: 'longOffset' }).formatToParts(d);
    return (parts.find(p => p.type === 'timeZoneName')?.value.replace("GMT", ""))??null;
}

// returns something like PDT
export function localTzShortName(d: Date): string|null {
    const parts = new Intl.DateTimeFormat(
        undefined, { timeZoneName: 'short' }).formatToParts(d);
    return (parts.find(p => p.type === 'timeZoneName')?.value)??null;
}

// localDateISO gives the YYYY-MM-DD format of the provided date in the user's timezone.
export function localDateISO(d: Date): string {
    const year = d.getFullYear().toString().padStart(4, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const date = d.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${date}`;
}

export function localTimeHHMM(date: Date): string {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

export function renderDate(date: string|undefined, type: string, _incidentOrFROrVisit: any): RenderValue {
    if (date === undefined) {
        return undefined;
    }
    const d = Date.parse(date);
    const fullDate = longFormatDate(d);
    switch (type) {
        case "display":
            const dateSpan = document.createElement("span");
            dateSpan.title = fullDate;
            dateSpan.append(shortDate.format(d), document.createElement("br"), shortTime.format(d));
            return dateSpan;
        case "filter":
            return shortDate.format(d) + " " + shortTime.format(d);
        case "type":
        case "sort":
        case undefined:
            return d;
        default:
            return undefined;
    }
}

export function renderState(state: IncidentState, type: string, incident: Incident): RenderValue {
    if (state == null) {
        state = stateForIncident(incident);
    }

    switch (type) {
        case "display":
        case "filter":
        case "type":
        case undefined:
            return stateNameFromID(state);
        case "sort":
            return stateSortKeyFromID(state);
        default:
            return undefined;
    }
}

export type RenderType = "filter"|"display"|"type"|"sort"|undefined;

export function renderLocation(data: EventLocation|null, type: RenderType, _incident: Incident): RenderValue {
    if (data == null) {
        return undefined;
    }
    switch (type) {
        case "display":
            return shortDescribeLocation(data);
        case "filter":
        case "sort":
        case "type":
        case undefined:
            return safeShortDescribeLocation(data)??"";
        default:
            return undefined;
    }
}

export function renderPersonHandles(data: IncidentPerson[]|null, type: RenderType, _incident: Incident): RenderValue {
    if (data == null) {
        return undefined;
    }
    // Display name is COALESCE(name, handle) so handle-less registry people still show.
    const handles = data.map(r=>personDisplayLabel(r)).filter(r=>r!=="");
    switch (type) {
        case "display":
            return renderSortedSpan(handles);
        case "filter":
        case "sort":
        case "type":
        case undefined:
            return handles.toSorted((a, b) => a.localeCompare(b)).join(", ");
        default:
            return undefined;
    }
}

//
// Populate journal entry text
//

function journalEntryElement(entry: JournalEntry): HTMLDivElement {
    // Build a container for the entry

    const entryContainer: HTMLDivElement = document.createElement("div");
    entryContainer.classList.add("journal_entry");

    const strikable: boolean = !entry.system_entry;

    if (entry.system_entry) {
        entryContainer.classList.add("journal_entry_system");
    } else if (entry.stricken) {
        entryContainer.classList.add("journal_entry_stricken");
    } else {
        entryContainer.classList.add("journal_entry_user");
    }

    if (entry.reportNum || entry.visitNum) {
        entryContainer.classList.add("journal_entry_merged");
    }

    // Add the timestamp and author, with a Strike/Unstrike button

    const metaDataContainer: HTMLParagraphElement = document.createElement("p");
    metaDataContainer.classList.add("journal_entry_metadata");

    if (strikable) {
        const strikeContainer: HTMLButtonElement = document.createElement("button");
        const entryId = entry.id!;
        const entryStricken = entry.stricken!;
        if (pathIds.incidentNumber != null) {
            // we're on the incident page
            if (entry.reportNum) {
                const entryMerged = entry.reportNum;
                // this is an entry from a report, as shown on the incident page
                strikeContainer.onclick = async (_e: MouseEvent): Promise<void> => {
                    await setStrikeJournalEntry(entryMerged, entryId, !entryStricken);
                }
            } else if (entry.visitNum) {
                const entryMerged = entry.visitNum;
                // this is an entry from a visit, as shown on the incident page
                strikeContainer.onclick = async (_e: MouseEvent): Promise<void> => {
                    await setStrikeVisitEntry(entryMerged, entryId, !entryStricken);
                }
            } else {
                const incidentNum = pathIds.incidentNumber;
                // this is an incident entry on the incident page
                strikeContainer.onclick = async (_e: MouseEvent): Promise<void> => {
                    await setStrikeIncidentEntry(incidentNum, entryId, !entryStricken);
                }
            }
        } else if (pathIds.reportNumber != null) {
            // we're on the report page
            const reportNum = pathIds.reportNumber;
            strikeContainer.onclick = async (_e: MouseEvent): Promise<void> => {
                await setStrikeJournalEntry(reportNum, entryId, !entryStricken);
            }
        } else if (pathIds.visitNumber != null) {
            // we're on the visit page
            const visitNum = pathIds.visitNumber;
            strikeContainer.onclick = async (_e: MouseEvent): Promise<void> => {
                await setStrikeVisitEntry(visitNum, entryId, !entryStricken);
            }
        }
        strikeContainer.classList.add("badge", "btn", "btn-danger", "remove-badge", "float-end");
        strikeContainer.textContent = entry.stricken ? "Unstrike" : "Strike";

        metaDataContainer.append(strikeContainer);
    }

    const timeStampContainer = timeElement(new Date(entry.created!));
    timeStampContainer.classList.add("journal_entry_timestamp");

    metaDataContainer.append(timeStampContainer, ", ");

    const authorContainer: HTMLSpanElement = document.createElement("span");
    authorContainer.textContent = entry.author??"(unknown)";
    authorContainer.classList.add("journal_entry_author");

    metaDataContainer.append(authorContainer);

    if (entry.reportNum) {
        metaDataContainer.append(" ");

        const link: HTMLAnchorElement = document.createElement("a");
        link.textContent = "report #" + entry.reportNum;
        link.href = `${urlReplace(url_viewReports)}/${entry.reportNum}`;

        metaDataContainer.append("(via ", link, ")");
        metaDataContainer.classList.add("journal_entry_source");
    } else if (entry.visitNum) {
        metaDataContainer.append(" ");

        const link: HTMLAnchorElement = document.createElement("a");
        link.textContent = "VS #" + entry.visitNum;
        link.href = `${urlReplace(url_viewVisits)}/${entry.visitNum}`;

        metaDataContainer.append("(via ", link, ")");
        metaDataContainer.classList.add("journal_entry_source");
    }

    metaDataContainer.append(":");

    entryContainer.append(metaDataContainer);

    // Add journal text
    const paragraphs: string[] = entry.text!.split(/\n\s*\n/);
    for (const paragraph of paragraphs) {
        const textContainer: HTMLParagraphElement = document.createElement("p");
        // Don't collapse whitespace; leave it how the user entered it.
        textContainer.style.whiteSpace = "pre-wrap";
        textContainer.classList.add("journal_entry_text");
        textContainer.textContent = paragraph;
        entryContainer.append(textContainer);
    }
    if (entry.attachment?.name && (pathIds.incidentNumber || pathIds.reportNumber || pathIds.visitNumber)) {

        let url: string = "";
        if (pathIds.reportNumber != null) {
            // Report attachment on Report page
            const reportNum = (pathIds.reportNumber??"wontHappen").toString();
            url = urlReplace(url_reportAttachmentNumber)
                .replace("<report_number>", reportNum)
                .replace("<attachment_number>", entry.id!.toString());
        } else if (pathIds.visitNumber != null) {
            // Visit attachment on visit page
            url = urlReplace(url_visitAttachmentNumber)
                .replace("<visit_number>", pathIds.visitNumber.toString())
                .replace("<attachment_number>", entry.id!.toString());
        } else if (pathIds.incidentNumber != null && entry.reportNum == null) {
            // incident attachment on incident page
            url = urlReplace(url_incidentAttachmentNumber)
                .replace("<incident_number>", pathIds.incidentNumber.toString())
                .replace("<attachment_number>", entry.id!.toString());
        } else if (pathIds.incidentNumber != null && entry.reportNum != null) {
            // Report attachment on incident page
            url = urlReplace(url_reportAttachmentNumber)
                .replace("<report_number>", entry.reportNum.toString())
                .replace("<attachment_number>", entry.id!.toString());
        } else if (pathIds.incidentNumber != null && entry.visitNum != null) {
            // Visit attachment on incident page
            url = urlReplace(url_visitAttachmentNumber)
                .replace("<visit_number>", entry.visitNum.toString())
                .replace("<attachment_number>", entry.id!.toString());
        } else {
            throw new Error(`Unknown attachment source for entry: ${entry}`);
        }

        const downloadButt: HTMLButtonElement = createSvgTextButton("#download", "Download");
        downloadButt.onclick = async (e: MouseEvent): Promise<void> => {
            e.preventDefault();
            const {resp, err} = await fetchNoThrow(url, {});
            if (err != null || resp == null) {
                setErrorMessage(`Failed to fetch attachment. ${err}`);
                return;
            }
            const blobUrl: string = window.URL.createObjectURL(await resp.blob());
            const tmpLink: HTMLAnchorElement = document.createElement("a");

            // Download mode: set a suggested filename.
            tmpLink.download = entry?.attachment?.name ?? "imsfile";
            tmpLink.href = blobUrl;
            document.body.appendChild(tmpLink);
            tmpLink.click();
            document.body.removeChild(tmpLink);
            URL.revokeObjectURL(blobUrl);
        };

        if (entry.attachment?.previewable) {
            const previewButt: HTMLButtonElement = createSvgTextButton("#preview", "Preview");

            // We need to do a JavaScript fetch of the file, rather than simply
            // opening a new browser tab that GETs it, because we have to send
            // the Authorization header.
            previewButt.onclick = async (e: MouseEvent): Promise<void> => {
                e.preventDefault();
                const {resp, err} = await fetchNoThrow(url, {});
                if (err != null || resp == null) {
                    setErrorMessage(`Failed to fetch attachment. ${err}`);
                    return;
                }
                const blobUrl: string = window.URL.createObjectURL(await resp.blob());
                const tmpLink: HTMLAnchorElement = document.createElement("a");

                // Preview mode: open a preview in a new window.
                // We'd use window.open with target _blank, but Safari iOS doesn't support that,
                // and a lot of people use iPhones.
                tmpLink.target = "_blank";
                tmpLink.href = blobUrl;
                document.body.appendChild(tmpLink);
                tmpLink.click();
                document.body.removeChild(tmpLink);

                // Wait a little while before cleaning up the blob, in case the user opts
                // to download the file from the preview (that will fail once the object URL
                // has been revoked).
                setTimeout(function (): void {
                    URL.revokeObjectURL(blobUrl);
                }, 60_000 /* milliseconds */);
            };
            entryContainer.append(previewButt);
        }
        entryContainer.append(downloadButt);
    }

    // Add a horizontal line after each entry

    const hr: HTMLHRElement = document.createElement("hr");
    hr.classList.add("m-1");
    entryContainer.append(hr);

    return entryContainer;
}

// Create a button that'll show an SVG icon and some text as its content.
// The svgID must reference an SVG that exists in the DOM already.
function createSvgTextButton(svgID: string, text: string): HTMLButtonElement {
    const buttonTemplate = document.getElementById("svg_butt_template") as HTMLTemplateElement;
    const buttonFrag = buttonTemplate.content.cloneNode(true) as DocumentFragment;
    buttonFrag.querySelector("use")!.setAttributeNS(null,"href",  svgID);
    buttonFrag.querySelector("span")!.textContent = text;
    return buttonFrag.querySelector("button")!;
}

export function drawJournalEntries(entries: JournalEntry[]): void {
    const container: HTMLElement = document.getElementById("journal_entries")!;
    container.replaceChildren();

    for (const entry of entries) {
        container.append(journalEntryElement(entry));
    }
}

export function journalEntryEdited(): void {
    const text = (document.getElementById("journal_entry_add")! as HTMLTextAreaElement).value.trim();
    const submitButton = document.getElementById("journal_entry_submit")!;

    submitButton.classList.remove("btn-default");
    submitButton.classList.remove("btn-warning");
    submitButton.classList.remove("btn-danger");

    if (!text) {
        submitButton.classList.add("disabled");
        submitButton.classList.add("btn-default");
    } else {
        submitButton.classList.remove("disabled");
        submitButton.classList.add("btn-warning");
    }
}

//
// Journal-entry draft persistence (localStorage)
//
// The journal-entry textarea is the one incident/report field that isn't
// autosaved per-keystroke (every other field POSTs on change). To avoid losing
// a half-written entry to a refresh, tab close, or dropped connection, we keep
// its text in localStorage, restore it on the next page load, and clear it once
// the entry is submitted. This is a draft cache, not an offline queue.

const journalDraftKeyPrefix = "journal_draft";
let journalDraftPageType: "incident"|"report"|null = null;
let journalDraftSaveTimer: number|null = null;

function journalDraftKeyFor(eventName: string, pageType: string, numberPart: string): string {
    return `${journalDraftKeyPrefix}_${eventName}_${pageType}_${numberPart}`;
}

// The localStorage key for the current page's draft, or null if drafts don't
// apply here. Keyed by (event, page type, number) so each incident/report — and
// the not-yet-numbered "new" page — has its own draft.
function journalDraftKey(): string|null {
    if (journalDraftPageType == null || pathIds.eventName == null) {
        return null;
    }
    const number = journalDraftPageType === "incident" ? pathIds.incidentNumber : pathIds.reportNumber;
    return journalDraftKeyFor(pathIds.eventName, journalDraftPageType, number == null ? "new" : `${number}`);
}

function journalDraftTextArea(): HTMLTextAreaElement|null {
    return document.getElementById("journal_entry_add") as HTMLTextAreaElement|null;
}

function hideJournalDraftNote(): void {
    document.getElementById("journal_draft_restored")?.classList.add("hidden");
}

// setJournalDraftPageType enables draft persistence for the current page and
// records its kind, so the draft key is unique per page type. Call once at init.
export function setJournalDraftPageType(pageType: "incident"|"report"): void {
    journalDraftPageType = pageType;
}

// saveJournalDraft debounces a write of the textarea contents to localStorage.
// Wire it to the textarea's "input" event.
export function saveJournalDraft(): void {
    hideJournalDraftNote();
    if (journalDraftSaveTimer != null) {
        window.clearTimeout(journalDraftSaveTimer);
    }
    journalDraftSaveTimer = window.setTimeout(flushJournalDraft, 400);
}

// flushJournalDraft writes the draft immediately, cancelling any pending
// debounced write. Also called synchronously from the beforeunload guard so the
// last keystrokes can't be lost.
export function flushJournalDraft(): void {
    if (journalDraftSaveTimer != null) {
        window.clearTimeout(journalDraftSaveTimer);
        journalDraftSaveTimer = null;
    }
    const key = journalDraftKey();
    const textArea = journalDraftTextArea();
    if (key == null || textArea == null) {
        return;
    }
    if (textArea.value === "") {
        localStorage.removeItem(key);
    } else {
        localStorage.setItem(key, textArea.value);
    }
}

// restoreJournalDraft loads a saved draft into the empty textarea on page load
// and shows a subtle "draft restored" note. Call once, after the fields are
// first drawn.
export function restoreJournalDraft(): void {
    const key = journalDraftKey();
    const textArea = journalDraftTextArea();
    if (key == null || textArea == null || textArea.value !== "") {
        return;
    }
    const draft = localStorage.getItem(key);
    if (!draft) {
        return;
    }
    textArea.value = draft;
    journalEntryEdited();
    document.getElementById("journal_draft_restored")?.classList.remove("hidden");
}

// migrateJournalDraftToNumber moves a draft from the "new" key to the real
// number once a brand-new incident/report is assigned one, so a reload right
// after creation still finds it.
export function migrateJournalDraftToNumber(newNumber: number): void {
    if (journalDraftPageType == null || pathIds.eventName == null) {
        return;
    }
    const oldKey = journalDraftKeyFor(pathIds.eventName, journalDraftPageType, "new");
    const newKey = journalDraftKeyFor(pathIds.eventName, journalDraftPageType, `${newNumber}`);
    if (oldKey === newKey) {
        return;
    }
    const draft = localStorage.getItem(oldKey);
    if (draft != null) {
        localStorage.setItem(newKey, draft);
        localStorage.removeItem(oldKey);
    }
}

// clearJournalDraft drops the saved draft and hides the note. Called after a
// successful submit.
function clearJournalDraft(): void {
    if (journalDraftSaveTimer != null) {
        window.clearTimeout(journalDraftSaveTimer);
        journalDraftSaveTimer = null;
    }
    const key = journalDraftKey();
    if (key != null) {
        localStorage.removeItem(key);
    }
    hideJournalDraftNote();
}

// The error callback for a journal entry strike call.
// This function is designed to work from either the incident
// or the report page.
function onStrikeError(err: string): void {
    const message = `Failed to set journal entry strike status: ${err}`;
    console.log(message);
    setErrorMessage(message);
}

// This is the function to call when a journal entry is successfully stricken.
// We need to be able to call either the incident.ts version or the report.ts
// version, depending on the current page in scope. The ims.ts TypeScript file should
// not depend on those files (lest there be a circular dependency), so we let those
// files register their functions here instead.
let strikeSuccessFunc: (() => Promise<void>)|null = null;
export function setOnStrikeSuccess(func: (() => Promise<void>)): void {
    strikeSuccessFunc = func;
}

async function setStrikeIncidentEntry(incidentNumber: number, journalEntryId: number, strike: boolean): Promise<void> {
    const url = urlReplace(url_incident_journalEntry)
        .replace("<incident_number>", incidentNumber.toString())
        .replace("<journal_entry_id>", journalEntryId.toString());
    const {err} = await fetchNoThrow(url, {
        body: JSON.stringify({"stricken": strike}),
    });
    if (err != null) {
        onStrikeError(err);
    } else {
        await strikeSuccessFunc!();
    }
}

async function setStrikeJournalEntry(reportNumber: number, journalEntryId: number, strike: boolean): Promise<void> {
    const url = urlReplace(url_report_journalEntry)
        .replace("<report_number>", reportNumber.toString())
        .replace("<journal_entry_id>", journalEntryId.toString());
    const {err} = await fetchNoThrow(url, {
        body: JSON.stringify({"stricken": strike}),
    });
    if (err != null) {
        onStrikeError(err);
    } else {
        await strikeSuccessFunc!();
    }
}

async function setStrikeVisitEntry(visitNumber: number, journalEntryId: number, strike: boolean): Promise<void> {
    const url = urlReplace(url_visit_journalEntry)
        .replace("<visit_number>", visitNumber.toString())
        .replace("<journal_entry_id>", journalEntryId.toString());
    const {err} = await fetchNoThrow(url, {
        body: JSON.stringify({"stricken": strike}),
    });
    if (err != null) {
        onStrikeError(err);
    } else {
        await strikeSuccessFunc!();
    }
}

// This is the function to call when edits are being sent to the server.
// We need to be able to call either the incident.ts version or the report.ts
// version, depending on the current page in scope. The ims.ts TypeScript file should
// not depend on those files (lest there be a circular dependency), so we let those
// files register their functions here instead.
let sendEditsFunc: ((edits: Incident|Report)=>Promise<{err:string|null}>)|null = null;
export function setSendEdits(func: ((edits: Incident|Report)=>Promise<{err:string|null}>)): void {
    sendEditsFunc = func;
}

export async function submitJournalEntry(): Promise<void> {
    const text = (document.getElementById("journal_entry_add") as HTMLTextAreaElement).value;

    if (!text) {
        return;
    }

    console.log("New journal entry:\n" + text);

    // Disable the submit button to prevent repeat submissions
    document.getElementById("journal_entry_submit")!.classList.add("disabled");
    // send a dummy ID to appease the JSON parser in the server
    const {err} = await sendEditsFunc!({"journal_entries": [{"text": text, "id": -1}]});
    if (err != null) {
        const submitButton = document.getElementById("journal_entry_submit")!;
        submitButton.classList.remove("disabled");
        submitButton.classList.remove("btn-default");
        submitButton.classList.remove("btn-warning");
        submitButton.classList.add("btn-danger");
        controlHasError(document.getElementById("journal_entry_add")!);
        return;
    }
    const textArea = document.getElementById("journal_entry_add") as HTMLTextAreaElement;
    // Clear the journal entry
    textArea.value = "";
    // Reset the submit button and its "disabled" status
    journalEntryEdited();
    // The entry is saved server-side now, so drop the local draft.
    clearJournalDraft();
}

//
// Generated history display
//

export function toggleShowHistory(): void {
    if ((document.getElementById("history_checkbox") as HTMLInputElement).checked) {
        document.getElementById("journal_entries")!.classList.remove("hide-history");
    } else {
        document.getElementById("journal_entries")!.classList.add("hide-history");
    }
}

export async function editFromElement(
    element: HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement,
    jsonKey: string,
    transform?: (v: string)=>string|number|null): Promise<void>
{
    let value: string|number|null = element.value;

    if (transform != null) {
        try {
            value = transform(value);
        } catch (e) {
            controlHasError(element);
            console.error(e);
            return;
        }
    }

    // Build a JSON object representing the requested edits

    const edits: EditMap = {};

    const keyPath: string[] = jsonKey.split(".");
    const lastKey: string = keyPath.pop()!;

    let current: EditMap = edits;
    for (const path of keyPath) {
        const next: EditMap = {};
        current[path] = next;
        current = next;
    }
    current[lastKey] = value??""

    // Send request to server

    const {err} = await sendEditsFunc!(edits);
    if (err != null) {
        controlHasError(element);
    } else {
        controlHasSuccess(element);
    }
}

//
// BroadcastChannel
//

export function newIncidentChannel(): BroadcastChannelTyped<IncidentBroadcast> {
    const incidentChannelName = "incident_update";
    return new BroadcastChannel(incidentChannelName);
}
export function newReportChannel(): BroadcastChannelTyped<ReportBroadcast> {
    const reportChannelName= "report_update";
    return new BroadcastChannel(reportChannelName);
}
export function newVisitChannel(): BroadcastChannelTyped<VisitBroadcast> {
    const visitChannelName= "visit_update";
    return new BroadcastChannel(visitChannelName);
}

//
// EventSource
//

const reattemptMinTimeMillis = 10000;
const lastSseIDKey = "last_sse_id";

// Call this from each browsing context, so that it can queue up to become a leader
// to manage the EventSource.
export function requestEventSourceLock(): void  {
    // The "navigator.locks" API is only available over secure browsing contexts.
    // Secure contexts include HTTPS as well as non-HTTPS via localhost, so this is
    // really only when you try to connect directly to another host without TLS.
    // https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
    if (!window.isSecureContext) {
        setErrorMessage("You're connected through an insecure browsing context. " +
            "Background SSE updates will not work!");
        return;
    }

    function tryAcquireLock(): Promise<void> {
        const {promise, resolve} = Promise.withResolvers<undefined>();
        subscribeToUpdates(resolve);
        return promise;
    }

    // Fire-and-forget this Promise to infinitely attempt to reconnect to the EventSource.
    // This addresses the following issue for when IMS lives on AWS, and ensures the
    // browsing context will always try to reestablish the EventSource connection.
    // https://github.com/burningmantech/ranger-ims-server/issues/1364
    new Promise<unknown>(async function(): Promise<void> {
        while (true) {
            const reattempt = new Promise(res => setTimeout(res, reattemptMinTimeMillis));
            // Acquire the lock, set up the EventSource, and start
            // broadcasting events to other browsing contexts.
            await navigator.locks.request("ims_eventsource_lock", tryAcquireLock);
            await reattempt;
        }
    });
    return;
}

// This starts the EventSource call and configures event listeners to propagate
// updates to BroadcastChannels. The idea is that only one browsing context should
// have an EventSource connection at any given time.
//
// The "closed" param is a callback to notify the caller that the EventSource has
// been closed.
function subscribeToUpdates(closed: (_value?: undefined)=>void): void {
    const eventSource = new EventSource(
        url_eventSource, { withCredentials: true }
    );

    eventSource.addEventListener("open", function(): void {
        console.log("Event listener opened");
    });

    eventSource.addEventListener("error", function(): void {
        if (eventSource.readyState === EventSource.CLOSED) {
            console.log("Event listener closed");
            eventSource.close();
            closed();
        } else {
            // EventSource automatically reconnects in this case.
            console.log("Event listener error");
        }
    });

    eventSource.addEventListener("InitialEvent", function(e: MessageEvent<string>) {
        const previousId = localStorage.getItem(lastSseIDKey);
        console.log(`Got InitialEvent. Its lastEventId is ${e.lastEventId} and previousId is ${previousId}`);
        if (e.lastEventId === previousId) {
            return;
        }
        localStorage.setItem(lastSseIDKey, e.lastEventId);
        newIncidentChannel().postMessage({update_all: true});
        newReportChannel().postMessage({update_all: true});
    });

    eventSource.addEventListener("Incident", function(e: MessageEvent<string>) {
        localStorage.setItem(lastSseIDKey, e.lastEventId);
        newIncidentChannel().postMessage(JSON.parse(e.data) as IncidentBroadcast);
    });

    eventSource.addEventListener("Report", function(e: MessageEvent<string>) {
        localStorage.setItem(lastSseIDKey, e.lastEventId);
        newReportChannel().postMessage(JSON.parse(e.data) as ReportBroadcast);
    });

    eventSource.addEventListener("Visit", function(e: MessageEvent<string>) {
        localStorage.setItem(lastSseIDKey, e.lastEventId);
        newVisitChannel().postMessage(JSON.parse(e.data) as VisitBroadcast);
    });
}

// Set the user-visible error information on the page to the provided string.
export function setErrorMessage(msg: string): void {
    msg = `Error: ${msg}`;
    const errText: HTMLElement|null = document.getElementById("error_text");
    if (errText) {
        errText.textContent = msg;
    }
    const errInfo: HTMLElement|null = document.getElementById("error_info");
    if (errInfo) {
        errInfo.classList.remove("hidden");
        errInfo.scrollIntoView();
    }
}

export function clearErrorMessage(): void {
    const errText: HTMLElement|null = document.getElementById("error_text");
    if (errText) {
        errText.textContent = "";
    }
    const errInfo: HTMLElement|null = document.getElementById("error_info");
    if (errInfo) {
        errInfo.classList.add("hidden");
    }
}

export function bsModal(el: HTMLElement) {
    // Use getOrCreateInstance (not `new`) so that showing and later
    // programmatically hiding a modal operate on the SAME Bootstrap instance.
    // With `new`, a hide() call creates a fresh instance whose _isShown is false,
    // so Bootstrap's hide() early-returns and the modal never closes.
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    // This is needed to resolve a Chrome Bootstrap ARIA bug
    // https://github.com/twbs/bootstrap/issues/41005#issuecomment-2497670835
    // Register the workaround once per element (getOrCreateInstance may be called
    // repeatedly for the same modal).
    if (el.dataset["bsModalAriaFix"] == null) {
        el.dataset["bsModalAriaFix"] = "true";
        el.addEventListener("hide.bs.modal", () => {
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
        });
    }
    return modal;
}

export function windowFragmentParams(): URLSearchParams {
    const fragment = window.location.hash.startsWith("#")
        ? window.location.hash.substring(1)
        : window.location.hash;
    return new URLSearchParams(fragment);
}

function getAccessToken(): string|null {
    return localStorage.getItem(accessTokenKey);
}

export function setAccessToken(token: string): void {
    localStorage.setItem(accessTokenKey, token);
}

export function setRefreshTokenBy(timeUnixMS: number): void {
    localStorage.setItem(accessTokenRefreshAfterKey, timeUnixMS.toString());
}

export function refreshTokenAfter(): number|null {
    return parseInt10(localStorage.getItem(accessTokenRefreshAfterKey));
}

export const incidentTableStates = ["all", "open", "active"] as const;
export type IncidentsTableState = typeof incidentTableStates[number];
export function isValidIncidentsTableState(value: string|null): value is IncidentsTableState {
    if (value) {
        return incidentTableStates.includes(value as IncidentsTableState);
    }
    return false;
}

export const visitsStatusValues = ["all", "current"] as const;
export type VisitsTableStatus = typeof visitsStatusValues[number];
export function isValidVisitsTableStatus(value: string|null): value is VisitsTableStatus {
    if (value) {
        return visitsStatusValues.includes(value as VisitsTableStatus);
    }
    return false;
}

export function setVisitsPreferredStatus(status: VisitsTableStatus|null): void {
    if (status) {
        localStorage.setItem(visitsPreferredStatusKey, status);
    } else {
        localStorage.removeItem(visitsPreferredStatusKey);
    }
}

export function getVisitsPreferredStatus(): VisitsTableStatus|null {
    const pref = localStorage.getItem(visitsPreferredStatusKey);
    if (isValidVisitsTableStatus(pref)) {
        return pref;
    }
    return null;
}

export function setIncidentsPreferredState(state: IncidentsTableState|null): void {
    if (state) {
        localStorage.setItem(incidentsPreferredStateKey, state);
    } else {
        localStorage.removeItem(incidentsPreferredStateKey);
    }
}

export function getIncidentsPreferredState(): IncidentsTableState|null {
    const pref = localStorage.getItem(incidentsPreferredStateKey);
    if (isValidIncidentsTableState(pref)) {
        return pref;
    }
    return null;
}

export const tableRowsPerPage = ["all", "25", "50", "100"] as const;
export type TableRowsPerPage = typeof tableRowsPerPage[number];
export function isValidTableRowsPerPage(value: string|null): value is TableRowsPerPage {
    if (value) {
        return tableRowsPerPage.includes(value as TableRowsPerPage);
    }
    return false;
}

export function setPreferredTableRowsPerPage(value: TableRowsPerPage|null): void {
    if (value) {
        localStorage.setItem(preferredTableRowsPerPageKey, value.toString());
    } else {
        localStorage.removeItem(preferredTableRowsPerPageKey);
    }
}

export function getPreferredTableRowsPerPage(): TableRowsPerPage|null {
    const pref: string|null = localStorage.getItem(preferredTableRowsPerPageKey);
    if (isValidTableRowsPerPage(pref)) {
        return pref;
    }
    return null;
}

export function coalesceRowsPerPage(...vals: (string|null)[]): TableRowsPerPage {
    for (const val of vals) {
        if (isValidTableRowsPerPage(val)) {
            return val;
        }
    }
    throw Error("No valid TableRowsPerPage value found");
}

export function clearLocalStorage(): void {
    localStorage.removeItem(accessTokenKey);
    localStorage.removeItem(accessTokenRefreshAfterKey);
    localStorage.removeItem(incidentsPreferredStateKey);
    localStorage.removeItem(visitsPreferredStatusKey);
    localStorage.removeItem(preferredTableRowsPerPageKey);
}

export function clearSessionStorage(): void {
    sessionStorage.clear();
}


//
// Load incident types
//

export async function loadIncidentTypes(): Promise<{types: IncidentType[], err: string|null}> {
    const {json, err} = await fetchNoThrow<IncidentType[]>(url_incidentTypes, null);
    if (err != null || json == null) {
        const message = `Failed to load incident types: ${err}`;
        console.error(message);
        setErrorMessage(message);
        return {
            types: [],
            err: message,
        };
    }
    json.sort((a: IncidentType, b: IncidentType): number => {
        return (a.name??"").localeCompare(b.name??"");
    });
    return {
        types: json,
        err: null,
    };
}

export function hideLoadingOverlay(): void {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

// Returns whether an input text-ish field is active. This is meant to talk about fields
// for which keyboard a-z letters are used, such as text field and select fields.
export function blockKeyboardShortcutFieldActive(): boolean {
    if (document.activeElement === document.body) {
        return false;
    }
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("modal")) {
        return false;
    }
    if (document.activeElement instanceof HTMLInputElement) {
        return document.activeElement.type !== "checkbox";
    }
    if (document.activeElement instanceof HTMLButtonElement) {
        return false;
    }
    return true;
}

// Remove the old LocalStorage caches that IMS no longer uses, so that
// they can't act against the ~5 MB per-domain limit of HTML5 LocalStorage.
// This can probably be removed after the 2025 event, when all the relevant
// computers have their caches purged.
function cleanupOldCaches(): void {
    localStorage.removeItem("lscache-ims.incident_types");
    localStorage.removeItem("lscache-ims.incident_types-cacheexpiration");
    localStorage.removeItem("lscache-ims.personnel");
    localStorage.removeItem("lscache-ims.personnel-cacheexpiration");
    localStorage.removeItem("ims.incident_types");
    localStorage.removeItem("ims.incident_types.deadline");
    localStorage.removeItem("ims.personnel");
    localStorage.removeItem("ims.personnel.deadline");
    localStorage.removeItem("incidents_preferred_state");
}
cleanupOldCaches();

export function assertInstanceof<T>(
    value: unknown, type: {new (...args: any): T},
    message?: string): asserts value is T {
    if (value instanceof type) {
        return;
    }

    if (!message && value instanceof HTMLElement) {
        message = `DOM element with id '${value.id}' has type ${value.constructor.name}, but wanted ${type.name || typeof type}`;
    }

    throw new Error(
        message || `Value ${value} is not of type ${type.name || typeof type}`
    );
}


export function typedElement<T>(
    elementOrId: HTMLElement | string | null,
    type: {new (...args: any): T},
    message?: string): T
{
    if (typeof elementOrId === "string") {
        elementOrId = document.getElementById(elementOrId);
    }
    assertInstanceof(elementOrId, type, message);
    return elementOrId;
}

//
// TypeScript declarations. These won't appear in the final JavaScript.
//

type AuthRefreshResponse = {
    token: string;
    expires_unix_ms: number;
}

export type PageInitResult = {
    authInfo: AuthInfo;
    eventDatas: Promise<EventData[]|null>;
}

interface EventLocation {
    // area_slug references a per-event AREA (Phase 4c); description is the
    // retained freeform "place / details" text; booth is an optional booth
    // number/identifier.
    area_slug?: string|null;
    description?: string|null;
    booth?: string|null;
}

export type LinkedIncident = {
    event_name?: string|null;
    event_id?: number|null;
    number?: number|null;
    summary?: string|null;
}

export type IncidentPerson = {
    person_id?: number|null;
    handle?: string|null;
    name?: string|null;
    involvement?: string|null;
}

export type VisitPerson = {
    person_id?: number|null;
    handle?: string|null;
    name?: string|null;
    involvement?: string|null;
}

// PersonSearchResult is the minimal typeahead shape returned by
// GET /ims/api/personnel?q=&event= (see docs/plans/51-people-registry.md).
export type PersonSearchResult = {
    person_id?: number|null;
    handle?: string|null;
    name?: string|null;
    wristband?: string|null;
    participation_type?: string|null;
}

export type IncidentState = 'new'|'on_hold'|'dispatched'|'on_scene'|'closed'|'null';

// IncidentOutcome is the disposition classification, orthogonal to IncidentState.
// An empty string means "no outcome recorded" (clears it on the server).
export type IncidentOutcome =
    ''|'information_only'|'resolved_on_scene'|'referred_to_coordinator'|
    'referred_to_management'|'referred_to_community_support'|
    'referred_to_mediation'|'follow_up_required'|'no_action_needed';

export type Incident = {
    number?: number|null;
    event?: string|null;
    state?: IncidentState|null;
    outcome?: IncidentOutcome|null;
    priority?: number|null;
    summary?: string|null;
    created?: string|null;
    started?: string|null;
    last_modified?: string|null;
    people?: IncidentPerson[]|null;
    incident_type_ids?: number[]|null;
    location?: EventLocation|null;
    journal_entries?: JournalEntry[]|null;
    reports?: number[]|null;
    visits?: number[]|null;
    linked_incidents?: LinkedIncident[]|null;
}

export type Report = {
    event?: string|null;
    number?: number|null;
    created?: string|null;
    summary?: string|null;
    incident?: number|null;
    journal_entries?: JournalEntry[]|null;
}

export type ReportsByNumber = Record<number, Report>;
export type VisitsByNumber = Record<number, Visit>;

export type Visit = {
    number?: number|null;
    event?: string|null;
    created?: string|null;
    last_modified?: string|null;
    incident?: number|null;

    // Guest identity links to a registry PERSON (slice 5e.3). guest_person_id is
    // read+write (<= 0 clears the link); guest_name/guest_handle are read-only,
    // resolved by the server from the linked PERSON for display.
    guest_person_id?: number|null;
    guest_name?: string|null;
    guest_handle?: string|null;
    guest_legal_name?: string|null;
    guest_description?: string|null;
    guest_action_plan?: string|null;
    guest_camp_name?: string|null;
    guest_camp_address?: string|null;
    guest_camp_description?: string|null;
    guest_camp_contacts?: string|null;

    arrival_time?: string|null;
    arrival_method?: string|null;
    arrival_state?: string|null;
    arrival_reason?: string|null;
    arrival_belongings?: string|null;

    departure_time?: string|null;
    departure_method?: string|null;
    departure_state?: string|null;

    resource_sitter?: string|null;
    resource_bed_id?: string|null;
    resource_rest?: string|null;
    resource_clothes?: string|null;
    resource_pogs?: string|null;
    resource_food_bev?: string|null;
    resource_other?: string|null;

    people?: VisitPerson[]|null;
    journal_entries?: JournalEntry[]|null;
}

export type EventData = {
    id: number,
    name: string,
    is_group?: boolean,
    parent_group?: number|null,
}

export interface Attachment {
    name?: string|null;
    previewable?: boolean|null;
}

export interface JournalEntry {
    id?: number|null;
    created?: string|null;
    author?: string|null;
    reportNum?: number|null,
    visitNum?: number|null,
    text?: string|null;
    system_entry?: boolean|null;
    stricken?: boolean|null;
    attachment?: Attachment|null;
}

export interface IncidentType {
    id?: number|null;
    name?: string|null;
    hidden?: boolean|null;
    description?: string|null;
    // OCF category (Phase 4a). Null/absent means ungrouped.
    group?: IncidentTypeGroup|null;
}

// OCF incident-type categories, listed in alphabetical display order so the
// type dropdown and info modal group headings sort predictably (6d.2). Types
// remain alphabetical within each group; ungrouped types sort last.
export type IncidentTypeGroup = "safety"|"conduct"|"operations"|"compliance";

export const incidentTypeGroups: IncidentTypeGroup[] = [
    "compliance", "conduct", "operations", "safety",
];

// incidentTypeGroupName returns the human-readable label for a group id, or
// "Ungrouped" for a null/absent/unknown group.
export function incidentTypeGroupName(group: string|null|undefined): string {
    switch (group) {
        case "safety": return "Safety";
        case "conduct": return "Conduct";
        case "operations": return "Operations";
        case "compliance": return "Compliance";
        default: return "Ungrouped";
    }
}

// compareIncidentTypesByGroup orders incident types by their group's position in
// incidentTypeGroups (alphabetical; ungrouped last), then alphabetically by name.
// Useful for clustering type lists/dropdowns by category.
export function compareIncidentTypesByGroup(a: IncidentType, b: IncidentType): number {
    const rank = (g: IncidentTypeGroup|null|undefined): number =>
        g ? incidentTypeGroups.indexOf(g) : incidentTypeGroups.length;
    const diff = rank(a.group) - rank(b.group);
    if (diff !== 0) {
        return diff;
    }
    return (a.name??"").localeCompare(b.name??"");
}

// Area is a per-event location (Phase 4c). slug is server-generated from the
// name on create and immutable thereafter; send an empty/absent slug to create
// and a populated slug to edit. parent_slug is null/absent for a top-level area.
export interface Area {
    slug?: string|null;
    name?: string|null;
    parent_slug?: string|null;
    sort_order?: number|null;
}

export type Areas = Area[];


export type UnauthenticatedAuthInfo = {
    authenticated: false,
}

export type AuthenticatedAuthInfo = {
    authenticated: true,
    user: string,
    admin: boolean,
    // Whether the user may manage people (e.g. set/reset passwords). Held by
    // admins today; gates the admin people UI.
    canManagePersonnel: boolean,
    event_access?: Record<string, AuthInfoEventAccess>,
}

export type AuthInfo = UnauthenticatedAuthInfo | AuthenticatedAuthInfo;

export type AuthInfoEventAccess = {
    event_id: number;
    readIncidents: boolean,
    writeIncidents: boolean,
    writeReports: boolean,
    readVisits: boolean,
    writeVisits: boolean,
    attachFiles: boolean,
}

export type Personnel = {
    handle: string;
    name?: string|null;
    // email is sent only by the admin People listing (?all=true) so it can be edited.
    email?: string|null;
    person_id?: number|null;
    is_admin?: boolean;
    onsite?: boolean;
    // wristband and participation_type are per-event; the admin listing populates
    // them when scoped to an event (?event=). See docs/plans/51-people-registry.md.
    wristband?: string|null;
    participation_type?: string|null;
    // These are the person statuses IMS recognizes (from the local PERSON table).
    status: "active"|"alpha"|"auditor"|"inactive extension"|"inactive"|"prospective";
}

// This is a simple wrapper to help with typing on BroadcastChannels. It's
// incomplete, e.g. no "addEventListener" implementation, so it may need
// expansion in the future.
interface BroadcastChannelTyped<T> extends EventTarget {
    postMessage(message: T): void;
    onmessage: ((this: BroadcastChannel, ev: MessageEvent<T>) => any) | null;
}

export type IncidentBroadcast = {
    // fields from SSE
    event_id?: number|null;
    incident_number?: number|null;
    // additional fields for use in BroadcastChannel
    update_all?: boolean;
}

export type ReportBroadcast = {
    // fields from SSE
    event_id?: number|null;
    report_number?: number|null;
    // additional fields for use in BroadcastChannel
    update_all?: boolean
}

export type VisitBroadcast = {
    // fields from SSE
    event_id?: number|null;
    visit_number?: number|null;
    // additional fields for use in BroadcastChannel
    update_all?: boolean
}

interface EditMap {
    [index: string]: EditMap|string|number;
}

export type FetchRes<T> = {
    resp: Response|null;
    json: T|null;
    err: string|null;
}

export interface Problem {
    type?: string|null;
    title?: string|null;
    status?: number|null;
    detail?: string|null;
    instance?: string|null;
    timestamp?: string|null;
}

interface DTAjax {
    reload(callback?: any, resetPaging?: boolean): void;
}

type DTData = Record<number, object>;

export interface DataTablesTable {
    on(event: string, callback: (jqueryEvent: object, dtSettings: object, json: object) => void): unknown;
    row: any;
    rows: any;
    data(): DTData;
    search: any;
    page: any;
    draw(paging?: boolean|"full-hold"|"full-reset"|"page"): unknown;
    ajax: DTAjax;
    processing(b: boolean): unknown;
}

// This is a minimal declaration of pieces of Bootstrap code on which we depend.
// See this repo for the full declaration:
// https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/bootstrap
export declare namespace bootstrap {
    class Modal {
        constructor(element: string | Element, options?: any);
        static getOrCreateInstance(element: string | Element, options?: any): Modal;
        toggle(relatedTarget?: HTMLElement): void;
        hide(): void;
        show(): void;
    }
}

declare let DataTable: any;

// This is fulfilled by FlatpickrJS.
declare let flatpickr: (selector: string|Node, opts: FlatpickrOptions)=>Flatpickr;

function newFlatpickrInternal(selector: string|Node, opts: FlatpickrOptions): Flatpickr {
    return flatpickr(selector, opts);
}

export function newFlatpickr(selector: string|Node, altInputId: string, onChange: FlatpickrEventFunc): Flatpickr {
    return newFlatpickrInternal(selector, {
        altInput: true,
        altFormat: 'D Y-m-d @ H:i',
        enableTime: true,
        allowInput: true,
        dateFormat: 'Y-m-d H:i',
        time_24hr: true,
        minuteIncrement: 5,
        onReady: function(_selectedDates: Date[], _dateStr: string, instance: Flatpickr): void {
            instance.altInput!.id = altInputId;
        },
        onChange: onChange,
        // This lets us set the date even on manual data entry in the altInput field.
        onClose: function(_selectedDates: Date[], _dateStr: string, instance: Flatpickr): void {
            instance.setDate(instance.altInput!.value, true, instance.config.altFormat!);
        },
    });
}

type FlatpickrEventFunc = (selectedDates: Date[], dateStr: string, instance: Flatpickr) => void;

export interface FlatpickrOptions {
    // See https://flatpickr.js.org/options/

    altInput?: boolean;
    altFormat?: string;
    allowInput?: boolean;
    enableTime?: boolean;
    dateFormat?: string;
    time_24hr?: boolean;
    minuteIncrement?: number;
    defaultHour?: number;
    defaultMinute?: number;
    onOpen?: FlatpickrEventFunc|FlatpickrEventFunc[];
    onClose?: FlatpickrEventFunc|FlatpickrEventFunc[];
    onReady?: FlatpickrEventFunc|FlatpickrEventFunc[];
    onChange?: FlatpickrEventFunc|FlatpickrEventFunc[];
}

export interface Flatpickr {
    config: FlatpickrOptions;
    selectedDates: Date[];
    input?: FlatpickrHTMLInputElement;
    altInput?: HTMLInputElement;
    setDate(date: Date|string|Date[], triggerChange: boolean, dateStrFormat: string): void;
    parseDate(date: string|number, format: string): Date;
}

export interface FlatpickrHTMLInputElement extends HTMLInputElement {
    _flatpickr: Flatpickr;
}
