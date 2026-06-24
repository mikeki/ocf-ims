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
        makeIncident: ()=>Promise<void>;
        editSummary: ()=>Promise<void>;
        toggleShowHistory: ()=>void;
        journalEntryEdited: ()=>void;
        submitJournalEntry: ()=>void;
        attachFile: ()=>void;
        updateIncident: (el: HTMLInputElement) => void;
    }
}

let report: ims.Report|null = null;

//
// Initialize UI
//

const el = {
    reportNumber: ims.typedElement("report_number", HTMLInputElement),
    reportSummary: ims.typedElement("report_summary", HTMLInputElement),
    incidentNumber: ims.typedElement("incident_number", HTMLInputElement),
    incidentNumberField: ims.typedElement("incident_number_field", HTMLElement),
    incidentNumberLink: ims.typedElement("incident_number_link", HTMLAnchorElement),
    createIncident: ims.typedElement("create_incident", HTMLElement),

    historyToggle: ims.typedElement("history_toggle", HTMLElement),
    historyCheckbox: ims.typedElement("history_checkbox", HTMLInputElement),
    journalEntryAdd: ims.typedElement("journal_entry_add", HTMLTextAreaElement),
    journalEntrySubmit: ims.typedElement("journal_entry_submit", HTMLElement),
    attachFile: ims.typedElement("attach_file", HTMLInputElement),
    attachFileInput: ims.typedElement("attach_file_input", HTMLInputElement),

    helpModal: ims.typedElement("helpModal", HTMLDivElement),
};

initReportPage();

async function initReportPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    const canReadReports = ims.eventAccess!.readIncidents || ims.eventAccess!.writeReports;
    if (!canReadReports) {
        ims.setErrorMessage(
            `You're not currently authorized to view Reports in Event "${ims.pathIds.eventName}".`
        );
        ims.hideLoadingOverlay();
        return;
    }

    window.makeIncident = makeIncident;
    window.editSummary = editSummary;
    window.toggleShowHistory = ims.toggleShowHistory;
    window.journalEntryEdited = ims.journalEntryEdited;
    window.submitJournalEntry = ims.submitJournalEntry;
    ims.setJournalDraftPageType("report");
    window.attachFile = attachFile;
    window.updateIncident = updateIncident;

    await loadAndDisplayReport();

    if (report == null) {
        return;
    }

    ims.hideLoadingOverlay();

    // for a new report
    if (report.number == null) {
        // assume that people without Incident access ought to see the instructions by default
        if (!ims.eventAccess?.readIncidents && !ims.eventAccess?.writeIncidents) {
            document.getElementById("fr-instructions")!.click();
        }
        el.reportSummary.focus();
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

    ims.newReportChannel().onmessage = async function (e: MessageEvent<ims.ReportBroadcast>): Promise<void> {
        const number = e.data.report_number;
        const eventId = e.data.event_id;
        const updateAll = e.data.update_all;

        if (updateAll || (eventId === ims.pathIds.eventName && number === ims.pathIds.reportNumber)) {
            console.log(`Got report update. number = ${number}, update_all = ${updateAll}`);
            await loadAndDisplayReport();
        }
    };

    const helpModal = ims.bsModal(el.helpModal);

    // Keyboard shortcuts
    document.addEventListener("keydown", function(e: KeyboardEvent): void {
        // No shortcuts when an input field is active
        if (ims.blockKeyboardShortcutFieldActive()) {
            return;
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
        // n --> new report
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
}

//
// Load report
//

async function loadReport(): Promise<{err: string|null}> {
    let number: number|null;
    if (report == null) {
        // First time here.  Use page JavaScript initial value.
        number = ims.pathIds.reportNumber??null;
    } else {
        // We have an incident already.  Use that number.
        number = report.number??null;
    }

    if (number == null) {
        report = {
            "number": null,
            "created": null,
        };
    } else {
        const {json, err} = await ims.fetchNoThrow<ims.Report>(
            `${ims.urlReplace(url_reports)}/${number}`, null);
        if (err != null) {
            ims.disableEditing();
            const message = "Failed to load report: " + err;
            console.error(message);
            ims.setErrorMessage(message);
            return {err: message};
        }
        report = json;
    }
    return {err: null};
}

async function loadAndDisplayReport(): Promise<void> {
    const {err} = await loadReport();

    if (report == null || err != null) {
        console.log(err);
        ims.setErrorMessage(err??"");
        ims.hideLoadingOverlay();
        return;
    }

    drawTitle();
    drawNumber();
    drawIncident();
    drawSummary();
    ims.toggleShowHistory();
    ims.drawJournalEntries(report.journal_entries??[]);
    ims.clearErrorMessage();

    el.journalEntryAdd.addEventListener("input", ims.journalEntryEdited);
    el.journalEntryAdd.addEventListener("input", ims.saveJournalDraft);

    if (ims.eventAccess?.writeReports) {
        ims.enableEditing();
    } else {
        ims.disableEditing();
    }

    if (ims.eventAccess?.attachFiles) {
        el.attachFile.classList.remove("hidden");
    }
}

async function updateIncident(el: HTMLInputElement): Promise<void> {
    // Only incident writers are allowed to attach/detach FRs from Incidents.
    if (!ims.eventAccess?.writeIncidents) {
        ims.controlHasError(el);
        await loadAndDisplayReport();
        return;
    }
    let url: string|null = null;
    if (report?.incident && el.value === "") {
        // The Report is attached to an incident and the user wants to detach it.
        url = (
            `${ims.urlReplace(url_reports)}/${report.number}` +
            `?action=detach&incident=${report.incident}`
        );
    } else {
        // The user wants to attach the Report to an incident.
        const incidentNumber = ims.parseInt10(el.value);
        if (incidentNumber == null || !report || !report?.number) {
            ims.controlHasError(el);
            return;
        }
        url = (
            `${ims.urlReplace(url_reports)}/${report.number}` +
            `?action=attach&incident=${incidentNumber}`
        );
    }
    const {err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify({}),
    });
    if (err != null) {
        ims.setErrorMessage(err);
        ims.controlHasError(el);
        return;
    }
    ims.controlHasSuccess(el);
    await loadAndDisplayReport();
}

//
// Populate page title
//

function drawTitle(): void {
    const eventSuffix = ims.pathIds.eventName != null ? ` | ${ims.pathIds.eventName}` : "";
    document.title = `${ims.reportAsString(report!)}${eventSuffix}`;
}


//
// Populate report number
//

function drawNumber(): void {
    const number: number|string = report!.number??"(new)";
    el.reportNumber.value = number.toString();
}

//
// Populate incident number or show "create incident" button
//

function drawIncident(): void {
    // On a brand-new Report there's no linked Incident yet (the IMS# field would
    // just show "(none)" and clicking it does nothing) and no history to show, so
    // hide both the IMS# field and the "Show history and stricken" toggle until the
    // Report has been saved.
    const isNewReport = report!.number == null;
    el.incidentNumberField.classList.toggle("hidden", isNewReport);
    el.historyToggle.classList.toggle("hidden", isNewReport);

    el.incidentNumber.value = "";
    // New Report. There can be no Incident
    if (isNewReport) {
        el.incidentNumber.placeholder = "(none)";
        return;
    }
    // If there's an attached Incident, then show a link to it
    const incident = report!.incident;
    if (incident != null) {
        const incidentURL = ims.urlReplace(url_viewIncidentNumber).replace("<number>", incident.toString());
        el.incidentNumber.value = incident.toString();
        el.incidentNumberLink.href = incidentURL;
    }
    el.incidentNumber.placeholder = "(none)";
    // If there's no attached Incident, show a button for making
    // a new Incident
    if (incident == null && ims.eventAccess?.writeIncidents) {
        el.createIncident.classList.remove("hidden");
    } else {
        el.createIncident.classList.add("hidden");
    }
    if (ims.eventAccess?.writeIncidents) {
        el.incidentNumber.readOnly = false;
        el.incidentNumber.classList.remove("form-control-static");
    }
}


//
// Populate report summary
//

function drawSummary(): void {
    el.reportSummary.placeholder = "One-line summary. **Pretty-please include an IMS# here**";
    if (report!.summary) {
        el.reportSummary.value = report!.summary;
        el.reportSummary.placeholder = "";
        return;
    }

    el.reportSummary.value = ims.summarizeIncidentOrReport(report!);
}


//
// Editing
//

async function reportSendEdits(edits: ims.Report): Promise<{err:string|null}> {
    if (report == null) {
        return {err: "report is null!"};
    }
    const number = report.number;
    let url = ims.urlReplace(url_reports);

    if (number == null) {
        // No fields are required for a new Report, nothing to do here
    } else {
        // We're editing an existing report.
        edits.number = number;
        url += `/${number}`;
    }

    const {resp, err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify(edits),
    });
    if (err != null) {
        const message = `Failed to apply edit: ${err}`;
        console.log(message);
        await loadAndDisplayReport();
        ims.setErrorMessage(message);
        return {err: message};
    }
    if (number == null) {
        // We created a new report.
        // We need to find out the created report number so that
        // future edits don't keep creating new resources.

        const newNumber: string|null = resp?.headers.get("IMS-Report-Number")??null;
        // Check that we got a value back
        if (newNumber == null) {
            return {err: "No IMS-Report-Number header provided."};
        }

        const newAsNumber = ims.parseInt10(newNumber);
        // Check that the value we got back is valid
        if (newAsNumber == null) {
            return {err: "Non-integer IMS-Report-Number header provided: " + newAsNumber};
        }

        // Store the new number in our report object
        ims.pathIds.reportNumber = report.number = newAsNumber;
        // Carry any locally-saved journal draft from the "new" key over to the
        // freshly-assigned number, so a reload after creation still finds it.
        ims.migrateJournalDraftToNumber(newAsNumber);

        // Update browser history to update URL
        drawTitle();
        window.history.pushState(
            null, document.title,
            `${ims.urlReplace(url_viewReports)}/${newNumber}`
        );

        // Fetch auth info again with the newly updated URL, just to update
        // the action log.
        await ims.getAuthInfo();
    }

    await loadAndDisplayReport();
    return {err: null};
}
ims.setSendEdits(reportSendEdits);

async function editSummary(): Promise<void> {
    await ims.editFromElement(el.reportSummary, "summary");
}

//
// Make a new incident and attach this Report to it
//

async function makeIncident(): Promise<void> {
    // Create the new incident
    const incidentsURL = ims.urlReplace(url_incidents);

    if (report == null) {
        ims.setErrorMessage("report is null!");
        return;
    }

    const authors: string[] = [];
    if (report.journal_entries) {
        authors.push(report.journal_entries[0]!.author??"null");
    }
    const {resp, err} = await ims.fetchNoThrow(incidentsURL, {
        body:JSON.stringify({
            "summary": report.summary,
            "ranger_handles": authors,
        }),
    });
    if (err != null || resp == null) {
        ims.disableEditing();
        ims.setErrorMessage(`Failed to create incident: ${err}`);
        return;
    }
    const newNum: string|null = resp.headers.get("IMS-Incident-Number");
    if (newNum == null) {
        ims.disableEditing();
        ims.setErrorMessage("Failed to create incident: no IMS Incident Number provided");
        return;
    }
    report.incident = ims.parseInt10(newNum);

    // Attach this Report to that new incident
    const attachToIncidentUrl =
        `${ims.urlReplace(url_reports)}/${report.number}` +
        `?action=attach&incident=${report.incident}`;
    const {err: attachErr} = await ims.fetchNoThrow(attachToIncidentUrl, {
        body: JSON.stringify({}),
    });
    if (attachErr != null) {
        ims.disableEditing();
        ims.setErrorMessage(`Failed to attach report: ${attachErr}`);
        return;
    }
    console.log("Created and attached to new incident " + report.incident);
    await loadAndDisplayReport();
}


// The success callback for a journal entry strike call.
async function reportOnStrikeSuccess(): Promise<void> {
    await loadAndDisplayReport();
    ims.clearErrorMessage();
}
ims.setOnStrikeSuccess(reportOnStrikeSuccess);

// Handle for the pending "Uploaded ✓" revert, so a fresh upload can cancel a
// stale revert from a previous one.
let attachFileRevertTimeout: number|null = null;

async function attachFile(): Promise<void> {
    if (attachFileRevertTimeout != null) {
        window.clearTimeout(attachFileRevertTimeout);
        attachFileRevertTimeout = null;
    }
    if (ims.pathIds.reportNumber == null) {
        // Report doesn't exist yet.  Create it first.
        const {err} = await reportSendEdits({});
        if (err != null) {
            return;
        }
    }
    const formData = new FormData();

    for (const f of el.attachFileInput.files??[]) {
        // this must match the key sought by the server
        formData.append("imsAttachment", f);
    }

    const attachURL = ims.urlReplace(url_reportAttachments)
        .replace("<report_number>", (ims.pathIds.reportNumber??"").toString());

    el.attachFile.disabled = true;
    el.attachFile.value = "Uploading...";
    try {
        const {err} = await ims.fetchNoThrow(attachURL, {
            body: formData,
        });
        if (err != null) {
            const message = `Failed to attach file: ${err}`;
            ims.setErrorMessage(message);
            el.attachFile.value = "Attach file";
            return;
        }
        ims.clearErrorMessage();
        el.attachFileInput.value = "";
        await loadAndDisplayReport();

        // Brief confirmation, then revert.
        el.attachFile.value = "Uploaded ✓";
        attachFileRevertTimeout = window.setTimeout((): void => {
            el.attachFile.value = "Attach file";
            attachFileRevertTimeout = null;
        }, 2000);
    } finally {
        el.attachFile.disabled = false;
    }
}
