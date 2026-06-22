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

import * as ims from "./ims.ts";

declare global {
    interface Window {
        editState: ()=>Promise<void>;
        editOutcome: ()=>Promise<void>;
        editIncidentSummary: ()=>Promise<void>;
        editLocationArea: ()=>Promise<void>;
        editLocationBooth: ()=>Promise<void>;
        editLocationDescription: ()=>Promise<void>;
        removePerson: (el: HTMLElement)=>void;
        setPersonInvolvement: (el: HTMLInputElement)=>void;
        removeIncidentType: (el: HTMLElement)=>Promise<void>;
        detachReport: (el: HTMLElement)=>Promise<void>;
        attachReport: ()=>Promise<void>;
        unlinkIncident: (el: HTMLElement)=>Promise<void>;
        linkIncident: (el: HTMLInputElement)=>Promise<void>;
        addIncidentType: ()=>Promise<void>;
        attachFile: ()=>void;
        drawMergedJournalEntries: ()=>void;
        toggleShowHistory: ()=>void;
        journalEntryEdited: ()=>void;
        submitJournalEntry: ()=>void;
    }
}

let incident: ims.Incident|null = null;

let allIncidentTypes: ims.IncidentType[] = [];

let allEvents: ims.EventData[]|null = null;

// The current event's areas, used to populate the location <select> (Phase 4c).
let eventAreas: ims.Area[] = [];

//
// Initialize UI
//

const el = {
    incidentNumber: ims.typedElement("incident_number", HTMLInputElement),
    incidentSummary: ims.typedElement("incident_summary", HTMLInputElement),
    incidentState: ims.typedElement("incident_state", HTMLSelectElement),
    incidentOutcome: ims.typedElement("incident_outcome", HTMLSelectElement),
    startedDatetime: ims.typedElement("started_datetime", HTMLInputElement) as ims.FlatpickrHTMLInputElement,
    startedDatetimeTz: ims.typedElement("started_datetime_tz", HTMLSpanElement),

    locationArea: ims.typedElement("incident_location_area", HTMLSelectElement),
    locationBooth: ims.typedElement("incident_location_booth", HTMLInputElement),
    locationDescription: ims.typedElement("incident_location_description", HTMLInputElement),

    personAdd: ims.typedElement("person_add", HTMLInputElement),
    personAddResults: ims.typedElement("person_add_results", HTMLElement),
    peopleList: ims.typedElement("incident_people_list", HTMLElement),
    peopleLiTemplate: ims.typedElement("incident_people_li_template", HTMLTemplateElement),

    incidentTypeAdd: ims.typedElement("incident_type_add", HTMLInputElement),
    incidentTypes: ims.typedElement("incident_types", HTMLDataListElement),
    incidentTypesList: ims.typedElement("incident_types_list", HTMLUListElement),
    incidentTypesRequired: ims.typedElement("incident_types_required", HTMLElement),
    incidentTypesLiTemplate: ims.typedElement("incident_types_li_template", HTMLTemplateElement),
    incidentTypeInfo: ims.typedElement("incident-type-info", HTMLUListElement),
    incidentTypeInfoTemplate: ims.typedElement("incident-type-info-template", HTMLTemplateElement),
    showIncidentTypeInfo: ims.typedElement("show-incident-type-info", HTMLElement),

    attachedReportLiTemplate: ims.typedElement("attached_report_li_template", HTMLTemplateElement),
    attachedReportAddContainer: ims.typedElement("attached_report_add_container", HTMLDivElement),
    attachedReportAdd: ims.typedElement("attached_report_add", HTMLSelectElement),
    attachedReports: ims.typedElement("attached_reports", HTMLUListElement),

    linkedIncidents: ims.typedElement("linked_incidents", HTMLElement),

    historyCheckbox: ims.typedElement("history_checkbox", HTMLInputElement),
    journalEntryAdd: ims.typedElement("journal_entry_add", HTMLTextAreaElement),
    journalEntrySubmit: ims.typedElement("journal_entry_submit", HTMLElement),
    attachFile: ims.typedElement("attach_file", HTMLInputElement),
    attachFileInput: ims.typedElement("attach_file_input", HTMLInputElement),

    helpModal: ims.typedElement("helpModal", HTMLDivElement),
};

initIncidentPage();

async function initIncidentPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    if (!ims.eventAccess!.readIncidents) {
        ims.setErrorMessage(
            `You're not currently authorized to view Incidents in Event "${ims.pathIds.eventName}".`
        );
        ims.hideLoadingOverlay();
        return;
    }

    window.editState = editState;
    window.editOutcome = editOutcome;
    window.editIncidentSummary = editIncidentSummary;
    window.editLocationArea = editLocationArea;
    window.editLocationBooth = editLocationBooth;
    window.editLocationDescription = editLocationDescription;
    window.removePerson = removePerson;
    window.setPersonInvolvement = setPersonInvolvement;
    window.removeIncidentType = removeIncidentType;
    window.detachReport = detachReport;
    window.attachReport = attachReport;
    window.unlinkIncident = unlinkIncident;
    window.linkIncident = linkIncident;
    window.addIncidentType = addIncidentType;
    window.attachFile = attachFile;
    window.drawMergedJournalEntries = drawMergedJournalEntries;
    window.toggleShowHistory = ims.toggleShowHistory;
    window.journalEntryEdited= ims.journalEntryEdited;
    window.submitJournalEntry = ims.submitJournalEntry;
    ims.setJournalDraftPageType("incident");

    // load everything from the APIs concurrently
    await Promise.all([
        await loadIncident(),
        await ims.loadIncidentTypes().then(
            value=> {
                // Cluster by OCF category so the add-dropdown and info modal
                // group types together (Phase 4a).
                allIncidentTypes = value.types.sort(ims.compareIncidentTypesByGroup);
            },
        ),
        await loadEventAreas(),
        await loadAllVisits(),
        await loadAllReports(),
    ]);

    allEvents = await initResult.eventDatas;

    ims.newFlatpickr("#started_datetime", "alt_started_datetime", setStartDatetime);

    ims.disableEditing();
    displayIncident();
    if (incident == null) {
        return;
    }
    drawPeople();
    setupPersonAdd();
    drawIncidentTypesToAdd();
    drawIncidentTypeInfo();
    renderReportData();

    ims.hideLoadingOverlay();

    // for a new incident, jump to summary field
    if (incident!.number == null) {
        el.incidentSummary.focus();
    }

    // Restore any unsaved journal-entry draft from a previous visit.
    ims.restoreJournalDraft();

    // Warn the user if they're about to navigate away with unsaved text.
    window.addEventListener("beforeunload", function (e: BeforeUnloadEvent): void {
        ims.flushJournalDraft();
        if (el.journalEntryAdd.value !== "") {
            e.preventDefault();
        }
    });

    ims.requestEventSourceLock();

    ims.newIncidentChannel().onmessage = async function (e: MessageEvent<ims.IncidentBroadcast>): Promise<void> {
        const number = e.data.incident_number;
        const eventId = e.data.event_id;
        const updateAll = e.data.update_all??false;

        if (updateAll || (eventId === ims.pathIds.eventId && number === ims.pathIds.incidentNumber)) {
            console.log("Got incident update: " + number);
            await loadAndDisplayIncident();
            await loadAllVisits();
            await loadAllReports();
            renderReportData();
        }
    };

    ims.newReportChannel().onmessage = async function (e: MessageEvent<ims.ReportBroadcast>): Promise<void> {
        const updateAll = e.data.update_all??false;
        if (updateAll) {
            console.log("Updating all reports");
            await loadAllReports();
            renderReportData();
            return;
        }

        const number = e.data.report_number;
        const eventId = e.data.event_id;
        if (eventId === ims.pathIds.eventId) {
            console.log("Got report update: " + number);
            await loadOneReport(number!);
            renderReportData();
            return;
        }
    };

    ims.newVisitChannel().onmessage = async function (e: MessageEvent<ims.VisitBroadcast>): Promise<void> {
        const updateAll = e.data.update_all??false;
        if (updateAll) {
            console.log("Updating all visits");
            await loadAllVisits();
            renderReportData();
            return;
        }

        const number = e.data.visit_number;
        const eventId = e.data.event_id;
        if (eventId === ims.pathIds.eventId) {
            console.log("Got visit update: " + number);
            await loadOneVisit(number!);
            renderReportData();
            return;
        }
    }

    const helpModal = ims.bsModal(el.helpModal);

    const incidentTypeInfoModal = ims.bsModal(document.getElementById("incidentTypeInfoModal")!);

    // Keyboard shortcuts
    document.addEventListener("keydown", function(e: KeyboardEvent): void {
        // No shortcuts when an input field is active
        if (ims.blockKeyboardShortcutFieldActive()) {
            return
        }
        // No shortcuts when ctrl, alt, or meta is being held down
        if (e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        // ? --> show help modal
        if (e.key === "?") {
            helpModal.toggle();
        }
        // a --> jump to add a new journal entry
        if (e.key === "a") {
            e.preventDefault();
            // Scroll to journal_entry_add field
            el.journalEntryAdd.focus();
            el.journalEntryAdd.scrollIntoView(true);
        }
        // h --> toggle showing system entries
        if (e.key.toLowerCase() === "h") {
            el.historyCheckbox.click();
        }
        // n --> new incident
        if (e.key.toLowerCase() === "n") {
            (window.open("./new", '_blank') as Window).focus();
        }
    });
    el.helpModal.addEventListener("keydown", function(e: KeyboardEvent): void {
        if (e.key === "?") {
            helpModal.toggle();
            // This is needed to prevent the document's listener for "?" to trigger the modal to
            // toggle back on immediately. This is fallout from the fix for
            // https://github.com/twbs/bootstrap/issues/41005#issuecomment-2497670835
            e.stopPropagation();
        }
    });
    el.journalEntryAdd.addEventListener("keydown", function (e: KeyboardEvent): void {
        const submitEnabled = !el.journalEntrySubmit.classList.contains("disabled");
        if (submitEnabled && (e.ctrlKey || e.altKey) && e.key === "Enter") {
            ims.submitJournalEntry();
        }
    });
    el.showIncidentTypeInfo.addEventListener(
        "click",
        function (e: MouseEvent): void {
            e.preventDefault();
            incidentTypeInfoModal.show();
        },
    );

    window.addEventListener("beforeprint", (_event: Event): void => {
        drawIncidentTitle("for_print_to_pdf");
    });
    window.addEventListener("afterprint", (_event: Event): void => {
        drawIncidentTitle("for_display");
    });
}


//
// Load incident
//

async function loadIncident(): Promise<{err: string|null}> {
    let number: number|null;
    if (incident == null) {
        // First time here.  Use page JavaScript initial value.
        number = ims.pathIds.incidentNumber??null;
    } else {
        // We have an incident already.  Use that number.
        number = incident.number!;
    }

    if (number == null) {
        incident = {
            "number": null,
            "state": "new",
            "priority": 3,
            "summary": "",
        };
    } else {
        const {json, err} = await ims.fetchNoThrow<ims.Incident>(
            `${ims.urlReplace(url_incidents)}/${number}`, null);
        if (err != null) {
            ims.disableEditing();
            const message = `Failed to load Incident ${number}: ${err}`;
            console.error(message);
            ims.setErrorMessage(message);
            return {err: message};
        }
        incident = json;
    }
    return {err: null};
}

async function loadAndDisplayIncident(): Promise<void> {
    await loadIncident();
    displayIncident();
}

function displayIncident(): void {
    if (incident == null) {
        const message = "Incident failed to load";
        console.log(message);
        ims.setErrorMessage(message);
        return;
    }

    drawIncidentFields();
    ims.clearErrorMessage();

    if (ims.eventAccess?.writeIncidents) {
        ims.enableEditing();
    }

    if (ims.eventAccess?.attachFiles) {
        el.attachFile.classList.remove("hidden");
    }
}

// Do all the client-side rendering based on the state of allReports.
function renderReportData(): void {
    loadAttachedReports();
    loadAttachedVisits();
    drawReportsToAttach();
    drawMergedJournalEntries();
    drawAttachedReportsVisits();
    drawLinkedIncidents();
}


//
// Load all reports and visits
//

let allReports: ims.Report[]|null|undefined = null;

async function loadAllReports(): Promise<{err: string|null}> {
    if (allReports === undefined) {
        return {err: null};
    }

    const {resp, json, err} = await ims.fetchNoThrow<ims.Report[]>(ims.urlReplace(url_reports), null);
    if (err != null) {
        if (resp != null && resp.status === 403) {
            // We're not allowed to look these up.
            allReports = undefined;
            console.error("Got a 403 looking up reports");
            return {err: null};
        } else {
            const message = `Failed to load reports: ${err}`;
            console.error(message);
            ims.setErrorMessage(message);
            return {err: message};
        }
    }
    const _allReports: ims.Report[] = [];
    for (const d of json!) {
        _allReports.push(d);
    }
    // apply a descending sort based on the report number,
    // being cautious about report number being null
    _allReports.sort(function (a, b) {
        return (b.number ?? -1) - (a.number ?? -1);
    });
    allReports = _allReports;
    return {err: null};
}

async function loadOneReport(reportNumber: number): Promise<{err: string|null}> {
    if (allReports === undefined) {
        return {err: null};
    }

    const {resp, json, err} = await ims.fetchNoThrow<ims.Report>(
        ims.urlReplace(url_report).replace("<report_number>", reportNumber.toString()), null);
    if (err != null) {
        if (resp == null || resp.status !== 403) {
            const message = `Failed to load report ${reportNumber} ${err}`;
            console.error(message);
            ims.setErrorMessage(message);
            return {err: message};
        }
    }

    let found = false;
    for (const i in allReports!) {
        if (allReports[i]!.number === json!.number) {
            allReports[i] = json!;
            found = true;
        }
    }
    if (!found) {
        if (allReports == null) {
            allReports = [];
        }
        allReports.push(json!);
        // apply a descending sort based on the report number,
        // being cautious about report number being null
        allReports.sort(function (a, b) {
            return (b.number ?? -1) - (a.number ?? -1);
        });
    }

    return {err: null};
}

let allVisits: ims.Visit[]|null|undefined = null;

// White Bird Visits is disabled for this year (we haven't connected with the
// White Bird team yet — see nav.templ). Keeping the visit list empty makes every
// visit surface on the incident form vanish cleanly: no options in the
// "Attached Reports/Visits" add dropdown, no attached visits drawn, and no visit
// text mixed into the cross-reference search. The backend and visit page code are
// intact — flip this back to true (and restore the labels in incident.templ) to
// re-enable next year.
const visitsEnabled = false;

async function loadAllVisits(): Promise<{err: string|null}> {
    if (allVisits === undefined) {
        return {err: null};
    }
    if (!visitsEnabled) {
        allVisits = [];
        return {err: null};
    }

    const {resp, json, err} = await ims.fetchNoThrow<ims.Visit[]>(ims.urlReplace(url_visits), null);
    if (err != null) {
        if (resp != null && resp.status === 403) {
            // We're not allowed to look these up.
            allReports = undefined;
            console.error("Got a 403 looking up visits");
            return {err: null};
        } else {
            const message = `Failed to load visits: ${err}`;
            console.error(message);
            ims.setErrorMessage(message);
            return {err: message};
        }
    }
    const visits: ims.Visit[] = [];
    for (const d of json!) {
        visits.push(d);
    }
    // apply a descending sort based on the visit number,
    // being cautious about visit number being null
    visits.sort(function (a, b) {
        return (b.number ?? -1) - (a.number ?? -1);
    });
    allVisits = visits;
    return {err: null};
}

async function loadOneVisit(visitNumber: number): Promise<{err: string|null}> {
    if (allVisits === undefined) {
        return {err: null};
    }
    if (!visitsEnabled) {
        return {err: null};
    }

    const {resp, json, err} = await ims.fetchNoThrow<ims.Visit>(
        ims.urlReplace(url_visitNumber).replace("<visit_number>", visitNumber.toString()), null);
    if (err != null) {
        if (resp == null || resp.status !== 403) {
            const message = `Failed to load visit ${visitNumber} ${err}`;
            console.error(message);
            ims.setErrorMessage(message);
            return {err: message};
        }
    }

    let found = false;
    for (const i in allVisits!) {
        if (allVisits[i]!.number === json!.number) {
            allVisits[i] = json!;
            found = true;
        }
    }
    if (!found) {
        if (allVisits == null) {
            allVisits = [];
        }
        allVisits.push(json!);
        // apply a descending sort based on the visit number,
        // being cautious about visit number being null
        allVisits.sort(function (a, b) {
            return (b.number ?? -1) - (a.number ?? -1);
        });
    }

    return {err: null};
}



//
// Load attached reports and visits
//

let attachedReports: ims.Report[]|null = null;

function loadAttachedReports() {
    if (ims.pathIds.incidentNumber == null) {
        return;
    }
    const _attachedReports: ims.Report[] = [];
    for (const fr of allReports??[]) {
        if (fr.incident === ims.pathIds.incidentNumber) {
            _attachedReports.push(fr);
        }
    }
    attachedReports = _attachedReports;
}

let attachedVisits: ims.Visit[]|null = null;

function loadAttachedVisits() {
    if (ims.pathIds.incidentNumber == null) {
        return;
    }
    const newAttachedVisits: ims.Visit[] = [];
    for (const s of allVisits??[]) {
        if (s.incident === ims.pathIds.incidentNumber) {
            newAttachedVisits.push(s);
        }
    }
    attachedVisits = newAttachedVisits;
}


//
// Draw all fields
//

function drawIncidentFields() {
    drawIncidentTitle("for_display");
    drawIncidentNumber();
    drawState();
    drawOutcome();
    drawStarted();
    drawPriority();
    drawIncidentSummary();
    drawPeople();
    drawIncidentTypes();
    drawLocationArea();
    drawLocationBooth();
    drawLocationDescription();
    ims.toggleShowHistory();
    drawMergedJournalEntries();

    el.journalEntryAdd.addEventListener("input", ims.journalEntryEdited);
    el.journalEntryAdd.addEventListener("input", ims.saveJournalDraft);
}


//
// Populate page title
//

function drawIncidentTitle(mode: "for_display"|"for_print_to_pdf"): void {
    let newTitle: string = "";
    if (mode === "for_print_to_pdf" && incident?.number) {
        const fsSafeDescription: string = ims.summarizeIncidentOrReport(incident)
            .replaceAll("#", "-")
            .replaceAll("\n", "-")
            .replaceAll(" ", "-")
            .replaceAll(":", "-")
            .replaceAll(";", "-")
            .replaceAll("!", "-")
            .replaceAll("$", "")
            .replace(/^-+/, "")
            .replace(/-+$/, "");
        newTitle = `IMS-${ims.pathIds.eventName}-${incident.number}_${fsSafeDescription}`
    } else {
        const eventSuffix: string = ims.pathIds.eventName != null ? ` | ${ims.pathIds.eventName}` : "";
        newTitle = `${ims.incidentAsString(incident!)}${eventSuffix}`;
    }
    document.title = newTitle;
}


//
// Populate incident number
//

function drawIncidentNumber(): void {
    const number: number|string = incident!.number??"(new)";
    el.incidentNumber.value = number.toString();
}


//
// Populate incident state
//

function drawState(): void {
    ims.selectOptionWithValue(
        el.incidentState,
        ims.stateForIncident(incident!)
    );
}


//
// Populate incident outcome (disposition; orthogonal to state)
//

function drawOutcome(): void {
    ims.selectOptionWithValue(
        el.incidentOutcome,
        incident?.outcome??"",
    );
}


//
// Populate started datetime
//

function drawStarted(): void {
    const date: string|null = incident!.started??null;
    if (date == null) {
        return;
    }
    const dateNum: number = Date.parse(date);
    const dateDate: Date = new Date(dateNum);
    el.startedDatetime._flatpickr.setDate(date, false, "Z");

    el.startedDatetimeTz.textContent = ims.localTzShortName(dateDate);
    el.startedDatetimeTz.title = `${Intl.DateTimeFormat().resolvedOptions().timeZone}\n\n` +
        `All date and time fields in IMS use your computer's time zone, not necessarily Gerlach time.`;
}

//
// Populate incident priority
//

function drawPriority(): void {
    const priorityElement = document.getElementById("incident_priority");
    // priority is currently hidden from the incident page, so we should expect this early return
    if (priorityElement == null) {
        return;
    }
    ims.selectOptionWithValue(
        priorityElement as HTMLSelectElement,
        (incident!.priority??"").toString(),
    )
}


//
// Populate incident summary
//

function drawIncidentSummary(): void {
    el.incidentSummary.placeholder = "One-line summary of incident";
    if (incident!.summary) {
        el.incidentSummary.value = incident!.summary;
        el.incidentSummary.placeholder = "";
        return;
    }

    el.incidentSummary.value = ims.summarizeIncidentOrReport(incident!);
}


//
// Populate people list
//

function drawPeople() {
    const people: ims.IncidentPerson[] = incident?.people??[];
    people.sort((a: ims.IncidentPerson, b: ims.IncidentPerson) =>
        ims.personDisplayLabel(a).localeCompare(ims.personDisplayLabel(b)));

    el.peopleList.querySelectorAll("li").forEach((li: HTMLElement) => {li.remove()});

    for (const person of people) {
        if (person.person_id == null) {
            continue;
        }
        const label = ims.personDisplayLabel(person);

        const personFragment = el.peopleLiTemplate.content.cloneNode(true) as DocumentFragment;
        const personLi = personFragment.querySelector("li")!;
        personLi.classList.remove("hidden");
        personLi.dataset["personId"] = person.person_id.toString();

        const personLink = personLi.querySelector("span")!.querySelector("a")!;
        personLink.textContent = label;

        const involvementInput = personLi.querySelector("input")!;
        involvementInput.ariaLabel = `Involvement for ${label}`;
        if (person.involvement) {
            involvementInput.value = person.involvement;
        }

        el.peopleList.append(personFragment);
    }
}


function setupPersonAdd(): void {
    const eventName = ims.pathIds.eventName ?? "";
    ims.setupPersonCombobox({
        input: el.personAdd,
        results: el.personAddResults,
        eventName: eventName,
        allowCreate: true,
        onPick: attachPersonToIncident,
        onCreate: (name) => ims.openQuickAddPersonModal(name, eventName),
    });
}


//
// Populate incident types list
//

function drawIncidentTypes() {
    el.incidentTypesList.querySelectorAll("li").forEach((li: HTMLElement) => {li.remove()});

    // At least one incident type is required (D-R2). Show a persistent inline
    // marker while none is attached, instead of only surprising the user with an
    // alert at close time (the close-time guard in editState remains a backstop).
    const hasType: boolean = (incident!.incident_type_ids??[]).length > 0;
    el.incidentTypesRequired.classList.toggle("hidden", hasType);

    for (const validType of allIncidentTypes) {
        if ((incident!.incident_type_ids??[]).includes(validType.id??-1)) {
            const fragment = el.incidentTypesLiTemplate.content.cloneNode(true) as DocumentFragment;
            const item = fragment.querySelector("li")!;
            item.classList.remove("hidden");
            const typeSpan = document.createElement("span");
            typeSpan.textContent = validType.name??"";
            item.append(typeSpan);
            item.dataset["incidentTypeId"] = (validType.id??-1).toString();
            el.incidentTypesList.append(fragment);
        }
    }
}


function drawIncidentTypesToAdd() {
    el.incidentTypes.replaceChildren();
    el.incidentTypes.append(document.createElement("option"));
    // allIncidentTypes is pre-sorted by category-then-name (for the grouped
    // checklist above). This flat <datalist> has no group headers, so a category
    // ordering reads as "unsorted" when scanning for a name — sort it plain
    // alphabetically here instead (slice 6h).
    const sorted = allIncidentTypes
        .filter(t => !t.hidden && t.name)
        .sort((a, b) => (a.name??"").localeCompare(b.name??""));
    for (const incidentType of sorted) {
        const option: HTMLOptionElement = document.createElement("option");
        option.value = incidentType.name!;
        el.incidentTypes.append(option);
    }
}

function drawIncidentTypeInfo(): void {
    // allIncidentTypes is pre-sorted by group, so emit a heading whenever the
    // group changes to show the OCF category structure (Phase 4a).
    let lastGroup: ims.IncidentTypeGroup|null|undefined;
    let first = true;
    for (const incidentType of allIncidentTypes) {
        if (incidentType.hidden) {
            continue;
        }
        const group = incidentType.group??null;
        if (first || group !== lastGroup) {
            const header = document.createElement("li");
            header.classList.add("fw-bold", "mt-2");
            header.textContent = ims.incidentTypeGroupName(group);
            el.incidentTypeInfo.append(header);
            lastGroup = group;
            first = false;
        }
        const frag = el.incidentTypeInfoTemplate.content.cloneNode(true) as DocumentFragment;
        frag.querySelector(".type-name")!.textContent = incidentType.name??"";
        frag.querySelector(".type-description")!.textContent = incidentType.description??"";
        el.incidentTypeInfo.append(frag);
    }
}


//
// Populate location
//

async function loadEventAreas(): Promise<void> {
    const {json, err} = await ims.fetchNoThrow<ims.Areas>(
        ims.urlReplace(url_areas), null,
    );
    if (err != null || json == null) {
        const message = `Failed to load areas: ${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    eventAreas = json;
}

// compareAreas orders areas by sort_order, then by name.
function compareAreas(a: ims.Area, b: ims.Area): number {
    const diff = (a.sort_order??0) - (b.sort_order??0);
    if (diff !== 0) {
        return diff;
    }
    return (a.name??"").localeCompare(b.name??"");
}

// drawAreaOptions rebuilds the location <select> from the event's areas: each
// top-level area followed by its children (single-level hierarchy), children
// indented. The leading "(none)" option clears the area.
function drawAreaOptions(): void {
    const select = el.locationArea;
    select.replaceChildren();

    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    select.append(none);

    const topLevel = eventAreas.filter(a => !a.parent_slug).sort(compareAreas);
    for (const area of topLevel) {
        select.append(areaOption(area, false));
        const children = eventAreas
            .filter(a => a.parent_slug === area.slug)
            .sort(compareAreas);
        for (const child of children) {
            select.append(areaOption(child, true));
        }
    }
}

function areaOption(area: ims.Area, indent: boolean): HTMLOptionElement {
    const opt = document.createElement("option");
    opt.value = area.slug??"";
    opt.textContent = indent ? `  — ${area.name??""}` : (area.name??"");
    return opt;
}

// drawLocationArea repopulates the options (the area list is event-scoped and
// loaded once) and selects the incident's current area, if any.
function drawLocationArea(): void {
    drawAreaOptions();
    el.locationArea.value = incident?.location?.area_slug??"";
}

function drawLocationBooth() {
    if (incident!.location?.booth) {
        el.locationBooth.value = incident!.location.booth;
    }
}

function drawLocationDescription() {
    if (incident!.location?.description) {
        el.locationDescription.value = incident!.location.description;
    }
}


//
// Draw journal entries
//

function drawMergedJournalEntries(): void {
    const entries: ims.JournalEntry[] = (incident!.journal_entries??[]).slice()

    for (const report of (attachedReports??[])) {
        for (const entry of report.journal_entries??[]) {
            entry.reportNum = report.number??null;
            entries.push(entry);
        }
    }

    for (const visit of (attachedVisits??[])) {
        for (const entry of visit.journal_entries??[]) {
            entry.visitNum = visit.number??null;
            entries.push(entry);
        }
    }

    entries.sort(ims.compareJournalEntries);

    ims.drawJournalEntries(entries);
}

function drawAttachedReportsVisits() {
    el.attachedReports.querySelectorAll("li").forEach((li: HTMLElement) => {li.remove()});

    const reports = attachedReports??[];
    const visits = attachedVisits??[];

    el.attachedReports.replaceChildren();

    for (const report of reports) {
        const fragment = el.attachedReportLiTemplate.content.cloneNode(true) as DocumentFragment;
        const item = fragment.querySelector("li")!;

        const link: HTMLAnchorElement = document.createElement("a");
        link.href = `${ims.urlReplace(url_viewReports)}/${report.number}`;
        link.innerText = ims.reportAsString(report);

        item.classList.remove("hidden");
        item.append(link);
        item.dataset["reportNumber"] = report.number!.toString();

        el.attachedReports.append(item);
    }
    for (const visit of visits) {
        const fragment = el.attachedReportLiTemplate.content.cloneNode(true) as DocumentFragment;
        const item = fragment.querySelector("li")!;

        const link: HTMLAnchorElement = document.createElement("a");
        link.href = `${ims.urlReplace(url_viewVisits)}/${visit.number}`;
        link.innerText = ims.visitAsString(visit);

        item.classList.remove("hidden");
        item.append(link);
        item.dataset["visitNumber"] = visit.number!.toString();

        el.attachedReports.append(item);
    }
}

let _linkedIncidentsItem: HTMLElement|null = null;

function drawLinkedIncidents(): void {
    if (_linkedIncidentsItem == null) {
        const elements = el.linkedIncidents.getElementsByClassName("list-group-item");
        if (elements.length === 0) {
            console.error("found no linkedIncidents");
            return;
        }
        _linkedIncidentsItem = elements[0] as HTMLElement;
    }

    const linkedIncidents = incident!.linked_incidents??[];
    linkedIncidents.sort(function (a: ims.LinkedIncident, b: ims.LinkedIncident): number {
        if ((b.event_name??"") === (a.event_name??"")) {
            return (a.number || 0) - (b.number || 0);
        }
        return (a.event_name??"").localeCompare(b.event_name??"");
    });

    el.linkedIncidents.replaceChildren();

    for (const linked of linkedIncidents) {
        const link: HTMLAnchorElement = document.createElement("a");

        link.href = url_viewIncidentNumber
            .replace("<event_id>", linked.event_name??"")
            .replace("<number>", linked.number?.toString()??"");

        let summary: string = ""
        if (linked.summary) {
            summary = `: ${linked.summary}`;
        }

        link.innerText = `IMS ${linked.event_name??""} #${linked.number}${summary}`;

        const item = _linkedIncidentsItem.cloneNode(true) as HTMLElement;
        item.classList.remove("hidden");
        item.append(link);
        item.dataset["eventId"] = linked.event_id?.toString();
        item.dataset["eventName"] = linked.event_name?.toString();
        item.dataset["incidentNumber"] = linked.number?.toString();

        el.linkedIncidents.append(item);
    }
}


function drawReportsToAttach() {
    el.attachedReportAdd.replaceChildren();
    el.attachedReportAdd.append(document.createElement("option"));

    const unattachedGroup: HTMLOptGroupElement = document.createElement("optgroup");
    unattachedGroup.label = "Unattached to any incident";
    el.attachedReportAdd.append(unattachedGroup);
    for (const report of allReports??[]) {
        // Skip reports that *are* attached to an incident
        if (report.incident != null) {
            continue;
        }
        const option: HTMLOptionElement = document.createElement("option");
        option.value = `R#${report.number!.toString()}`;
        option.text = ims.reportAsString(report);
        el.attachedReportAdd.append(option);
    }
    for (const visit of allVisits??[]) {
        // Skip visits that *are* attached to an incident
        if (visit.incident != null) {
            continue;
        }
        const option: HTMLOptionElement = document.createElement("option");
        option.value = `VS#${visit.number!.toString()}`;
        option.text = ims.visitAsString(visit);
        el.attachedReportAdd.append(option);
    }
    const attachedGroup: HTMLOptGroupElement = document.createElement("optgroup");
    attachedGroup.label = "Attached to another incident";
    el.attachedReportAdd.append(attachedGroup);
    for (const report of allReports??[]) {
        // Skip reports that *are not* attached to an incident
        if (report.incident == null) {
            continue;
        }
        // Skip reports that are already attached this incident
        if (report.incident === ims.pathIds.incidentNumber) {
            continue;
        }
        const option: HTMLOptionElement = document.createElement("option");
        option.value = `R#${report.number!.toString()}`;
        option.text = ims.reportAsString(report);
        el.attachedReportAdd.append(option);
    }
    for (const visit of allVisits??[]) {
        // Skip visits that *are not* attached to an incident
        if (visit.incident == null) {
            continue;
        }
        // Skip visits that are already attached this incident
        if (visit.incident === ims.pathIds.incidentNumber) {
            continue;
        }
        const option: HTMLOptionElement = document.createElement("option");
        option.value = `VS#${visit.number!.toString()}`;
        option.text = ims.visitAsString(visit);
        el.attachedReportAdd.append(option);
    }
    el.attachedReportAdd.append(document.createElement("optgroup"));

    el.attachedReportAddContainer.classList.remove("hidden");
}


//
// Editing
//

async function sendEdits(edits: ims.Incident): Promise<{err:string|null}> {
    const number = incident!.number;
    let url = ims.urlReplace(url_incidents);

    if (number == null) {
        // We're creating a new incident.
        // required fields are ["state", "priority"];
        if (edits.state == null) {
            edits.state = incident!.state??null;
        }
        if (edits.priority == null) {
            edits.priority = incident!.priority??null;
        }
    } else {
        // We're editing an existing incident.
        edits.number = number;
        url += `/${number}`;
    }

    const {resp, err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify(edits),
    });

    if (err != null) {
        const message = `Failed to apply edit: ${err}`;
        await loadAndDisplayIncident();
        ims.setErrorMessage(message);
        return {err: message};
    }

    if (number == null && resp != null) {
        // We created a new incident.
        // We need to find out the created incident number so that future
        // edits don't keep creating new resources.

        let newNumber: string|number|null = resp.headers.get("IMS-Incident-Number");
        // Check that we got a value back
        if (newNumber == null) {
            const msg = "No IMS-Incident-Number header provided.";
            ims.setErrorMessage(msg);
            return {err: msg};
        }

        newNumber = ims.parseInt10(newNumber);
        // Check that the value we got back is valid
        if (newNumber == null) {
            const msg = "Non-integer IMS-Incident-Number header provided:" + newNumber;
            ims.setErrorMessage(msg);
            return {err: msg};
        }

        // Store the new number in our incident object
        ims.pathIds.incidentNumber = incident!.number = newNumber;
        // Carry any locally-saved journal draft from the "new" key over to the
        // freshly-assigned number, so a reload after creation still finds it.
        ims.migrateJournalDraftToNumber(newNumber);

        // Update browser history to update URL
        drawIncidentTitle("for_display");
        window.history.pushState(
            null, document.title, `${ims.urlReplace(url_viewIncidents)}/${newNumber}`
        );

        // Fetch auth info again with the newly updated URL, just to update
        // the action log.
        await ims.getAuthInfo();
    }

    await loadAndDisplayIncident();
    return {err: null};
}
ims.setSendEdits(sendEdits);

async function editState(): Promise<void> {
    if (el.incidentState.value === "closed" && (incident!.incident_type_ids??[]).length === 0) {
        window.alert(
            "Closing out this incident?\n"+
            "Please add an incident type!\n\n" +
            "Special cases:\n" +
            "    Junk: for erroneously-created Incidents\n" +
            "    Admin: for administrative information, i.e. not Incidents at all\n\n" +
            "See the Incident Types help link for more details.\n"
        );
    }

    await ims.editFromElement(el.incidentState, "state");
}

async function editOutcome(): Promise<void> {
    await ims.editFromElement(el.incidentOutcome, "outcome");
}

async function setStartDatetime(selectedDates: Date[], _dateStr: string, sender: ims.Flatpickr): Promise<void> {
    const prevDate = new Date(incident?.started??0);
    const newDate = selectedDates[0];
    if (!newDate || newDate.getTime() === prevDate.getTime()) {
        // nothing to do
        return;
    }

    await ims.editFromElement(sender.altInput!, "started", (_: string|null):string=> {
        return newDate.toISOString();
    });
}

async function editIncidentSummary(): Promise<void> {
    await ims.editFromElement(el.incidentSummary, "summary");
}


async function editLocationArea(): Promise<void> {
    await ims.editFromElement(el.locationArea, "location.area_slug");
}

async function editLocationBooth(): Promise<void> {
    await ims.editFromElement(el.locationBooth, "location.booth");
}

async function editLocationDescription(): Promise<void> {
    await ims.editFromElement(el.locationDescription, "location.description");
}

async function removePerson(sender: HTMLElement): Promise<void> {
    const parent = sender.parentElement as HTMLElement;
    const personId = parent.dataset["personId"];
    if (!personId) {
        return;
    }

    const url = (
        ims.urlReplace(url_incidentPerson)
            .replace("<incident_number>", ims.pathIds.incidentNumber!.toString())
            .replace("<person_id>", encodeURIComponent(personId))
    );
    await ims.fetchNoThrow(url, {
        method: "DELETE",
    });
}

async function setPersonInvolvement(sender: HTMLInputElement): Promise<void> {
    const personId = sender.closest("li")?.dataset["personId"];
    if (!personId) {
        console.log("no person id for element");
        return;
    }

    const url = (
        ims.urlReplace(url_incidentPerson)
            .replace("<incident_number>", ims.pathIds.incidentNumber!.toString())
            .replace("<person_id>", encodeURIComponent(personId))
    );
    const {err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify({
            involvement: sender.value,
        }),
    });
    if (err !== null) {
        ims.controlHasError(sender);
        return;
    }
    ims.controlHasSuccess(sender);

    return;
}


async function removeIncidentType(sender: HTMLElement): Promise<void> {
    const parent = sender.parentElement as HTMLElement;
    const incidentType = ims.parseInt10(parent.dataset["incidentTypeId"]);
    await sendEdits({
        "incident_type_ids": (incident!.incident_type_ids??[]).filter(
            function(t) { return t !== incidentType; }
        ),
    });
}

function normalize(str: string): string {
    return str.toLowerCase().trim();
}

async function attachPersonToIncident(person: ims.PersonSearchResult): Promise<void> {
    if (person.person_id == null) {
        return;
    }
    el.personAdd.disabled = true;

    if (ims.pathIds.incidentNumber == null) {
        // Incident doesn't exist yet. Create it first.
        const {err} = await sendEdits({});
        if (err != null) {
            el.personAdd.disabled = false;
            return;
        }
    }

    const url = (
        ims.urlReplace(url_incidentPerson)
            .replace("<incident_number>", ims.pathIds.incidentNumber!.toString())
            .replace("<person_id>", person.person_id.toString())
    );
    const {err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify({}),
    });
    el.personAdd.disabled = false;
    if (err !== null) {
        ims.controlHasError(el.personAdd);
        return;
    }
    ims.controlHasSuccess(el.personAdd);
    el.personAdd.focus();
}


async function addIncidentType(): Promise<void> {
    let typeInput = el.incidentTypeAdd.value;

    // make a copy of the incident types
    const currentIncidentTypes = (incident!.incident_type_ids??[]).slice();

    // fuzzy-match on incidentType, to allow case insensitivity and
    // leading/trailing whitespace.
    const normalizedTypeInput = normalize(typeInput);
    // let validTypeInput: string = "";
    let validTypeInputId: number|null = null;
    for (const validType of allIncidentTypes) {
        if (!validType.hidden && validType.name && normalizedTypeInput === normalize(validType.name)) {
            validTypeInputId = validType.id??null;
            break;
        }
    }
    if (validTypeInputId == null) {
        // Not a valid incident type
        el.incidentTypeAdd.value = "";
        return;
    }

    if (currentIncidentTypes.indexOf(validTypeInputId) !== -1) {
        // Already in the list, so… move along.
        el.incidentTypeAdd.value = "";
        return;
    }

    currentIncidentTypes.push(validTypeInputId);

    el.incidentTypeAdd.disabled = true;
    const {err} = await sendEdits({"incident_type_ids": currentIncidentTypes});
    if (err != null) {
        ims.controlHasError(el.incidentTypeAdd);
        el.incidentTypeAdd.value = "";
        el.incidentTypeAdd.disabled = false;
        return;
    }
    el.incidentTypeAdd.value = "";
    el.incidentTypeAdd.disabled = false;
    ims.controlHasSuccess(el.incidentTypeAdd);
    el.incidentTypeAdd.focus();
}


async function detachReport(sender: HTMLElement): Promise<void> {
    const parent: HTMLElement = sender.parentElement!;
    const reportNumber = parent.dataset["reportNumber"]||null;
    const visitNumber = parent.dataset["visitNumber"]||null;

    let err: string|null = null;
    if (reportNumber) {
        const url = (
            `${ims.urlReplace(url_reports)}/${reportNumber}` +
            `?action=detach&incident=${ims.pathIds.incidentNumber}`
        );
        ({err} = await ims.fetchNoThrow(url, {
            body: JSON.stringify({}),
        }));
    } else if (visitNumber) {
        const url = `${ims.urlReplace(url_visits)}/${visitNumber}`;
        const visit: ims.Visit = {
            event: ims.pathIds.eventName,
            number: ims.parseInt10(visitNumber),
            incident: 0,
        };
        ({err} = await ims.fetchNoThrow(url, {
            body: JSON.stringify(visit),
        }));
    }
    if (err != null) {
        const message = `Failed to detach report ${err}`;
        console.log(message);
        await loadAllVisits();
        await loadAllReports();
        renderReportData();
        ims.setErrorMessage(message);
        return;
    }
    await loadAllVisits();
    await loadAllReports();
    renderReportData();
}


async function attachReport(): Promise<void> {
    if (ims.pathIds.incidentNumber == null) {
        // Incident doesn't exist yet. Create it first.
        const {err} = await sendEdits({});
        if (err != null) {
            return;
        }
    }

    let err: string | null = null;
    if (el.attachedReportAdd.value.startsWith("R#")) {
        const reportNumber = el.attachedReportAdd.value.substring("R#".length);
        const url = (
            `${ims.urlReplace(url_reports)}/${reportNumber}` +
            `?action=attach&incident=${ims.pathIds.incidentNumber}`
        );
        ({err} = await ims.fetchNoThrow(url, {
            body: JSON.stringify({}),
        }));
    } else if (el.attachedReportAdd.value.startsWith("VS#")) {
        const visitNumber = el.attachedReportAdd.value.substring("VS#".length);
        const url = `${ims.urlReplace(url_visits)}/${visitNumber}`;
        const visit: ims.Visit = {
            event: ims.pathIds.eventName,
            number: ims.parseInt10(visitNumber),
            incident: ims.pathIds.incidentNumber,
        };
        ({err} = await ims.fetchNoThrow(url, {
            body: JSON.stringify(visit),
        }));
    }
    if (err != null) {
        const message = `Failed to attach: ${err}`;
        console.log(message);
        await loadAllVisits();
        await loadAllReports();
        renderReportData();
        ims.setErrorMessage(message);
        ims.controlHasError(el.attachedReportAdd);
        return;
    }
    await loadAllVisits();
    await loadAllReports();
    renderReportData();
    ims.controlHasSuccess(el.attachedReportAdd);
}

async function unlinkIncident(sender: HTMLElement): Promise<void> {
    const parent = sender.parentElement as HTMLElement;
    const linkedEventId = ims.parseInt10(parent.dataset["eventId"]);
    const linkedIncidentNumber = ims.parseInt10(parent.dataset["incidentNumber"]);
    await sendEdits({
        "linked_incidents": (incident!.linked_incidents??[]).filter(
            function(t: ims.LinkedIncident): boolean {
                return ! (t.event_id === linkedEventId && t.number === linkedIncidentNumber);
            }
        ),
    });
}

async function linkIncident(input: HTMLInputElement): Promise<void> {
    if (ims.pathIds.incidentNumber == null) {
        // Incident doesn't exist yet. Create it first.
        const {err} = await sendEdits({});
        if (err != null) {
            return;
        }
    }

    const currentEventId = (allEvents??[]).find(value => value.name === ims.pathIds.eventName)!.id;
    const currentLinkedIncidents: ims.LinkedIncident[] = (incident!.linked_incidents??[]).slice();
    let wouldMakeAChange: boolean = false;

    for (let eventAndIncident of input.value.trim().split(",")) {
        // Assume the current event unless another is specified
        let eventID: number|null = currentEventId;
        let incidentNumber: number|null = null;

        eventAndIncident = eventAndIncident.trim();
        // Remove any "#" prefix, since "#123" means the same as "123" (current event, IMS #123).
        if (eventAndIncident.indexOf("#") === 0) {
            eventAndIncident = eventAndIncident.substring(1);
        }

        if (eventAndIncident.indexOf("#") === -1) {
            incidentNumber = ims.parseInt10(eventAndIncident.trim());
        }
        if (eventAndIncident.indexOf("#") > 0) {
            let eventAndIncidentPair: string[] = eventAndIncident.split("#", 2);
            const eventName: string = (eventAndIncidentPair[0]??"").trim();
            if (!eventName) {
                ims.controlHasError(input);
                ims.setErrorMessage(`Invalid format for linked incident. Got '${eventAndIncident}'`);
                input.value = "";
                input.disabled = false;
                return;
            }
            eventID = (allEvents??[]).find(value => value.name === eventName)?.id||null;
            if (!eventID) {
                ims.controlHasError(input);
                ims.setErrorMessage(`There is no Event for name '${eventName}' or you're not may not be authorized to access it`);
                input.value = "";
                input.disabled = false;
                return;
            }
            incidentNumber = ims.parseInt10((eventAndIncidentPair[1]??"").trim());
        }
        const linkedIncident: ims.LinkedIncident = {
            event_id: eventID,
            number: incidentNumber,
        };

        const selfLink: boolean = linkedIncident.event_id === currentEventId && linkedIncident.number === incident?.number;
        if (!selfLink) {
            currentLinkedIncidents.push(linkedIncident!);
            wouldMakeAChange = true;
        }
    }

    if (!wouldMakeAChange) {
        ims.controlHasError(input);
        ims.setErrorMessage("No valid other incidents were provided for linking");
        input.value = "";
        input.disabled = false;
        return;
    }

    input.disabled = true;
    const {err} = await sendEdits({"linked_incidents": currentLinkedIncidents});
    if (err != null) {
        ims.controlHasError(input);
        input.value = "";
        input.disabled = false;
        return;
    }
    input.value = "";
    input.disabled = false;
    ims.controlHasSuccess(input);
    input.focus();
}


// The success callback for a journal entry strike call.
async function onStrikeSuccess(): Promise<void> {
    await loadAndDisplayIncident();
    await loadAllVisits();
    await loadAllReports();
    renderReportData();
    ims.clearErrorMessage();
}
ims.setOnStrikeSuccess(onStrikeSuccess);

async function attachFile(): Promise<void> {
    if (ims.pathIds.incidentNumber == null) {
        // Incident doesn't exist yet.  Create it first.
        const {err} = await sendEdits({});
        if (err != null) {
            return;
        }
    }
    const formData = new FormData();

    for (const f of el.attachFileInput.files??[]) {
        // this must match the key sought by the server
        formData.append("imsAttachment", f);
    }

    const attachURL = ims.urlReplace(url_incidentAttachments)
        .replace("<incident_number>", (ims.pathIds.incidentNumber??"").toString());
    const {err} = await ims.fetchNoThrow(attachURL, {
        body: formData
    });
    if (err != null) {
        const message = `Failed to attach file: ${err}`;
        ims.setErrorMessage(message);
        return;
    }
    ims.clearErrorMessage();
    el.attachFileInput.value = "";
    await loadAndDisplayIncident();
}
