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

// Chart.js is loaded as a UMD global by head.templ (charts flag); declare it so
// this module can reference it without bundling type definitions.
declare const Chart: any;

// Mirror of json.Metrics (see api/metrics.go).
interface MetricCount { key: string; label: string; count: number; }
interface MetricDay { date: string; count: number; }
interface MetricIncidentRef { number: number; summary: string; }
interface Metrics {
    event: string;
    event_id: number;
    total: number;
    open: number;
    closed: number;
    by_state: MetricCount[];
    by_priority: MetricCount[];
    by_category: MetricCount[];
    by_type: MetricCount[];
    by_area: MetricCount[];
    by_day: MetricDay[];
    open_follow_ups: MetricIncidentRef[];
    avg_time_to_close_seconds: number|null;
    closed_count: number;
    generated_at_ms: number;
}

const el = {
    statTotal: ims.typedElement("stat_total", HTMLElement),
    statOpen: ims.typedElement("stat_open", HTMLElement),
    statClosed: ims.typedElement("stat_closed", HTMLElement),
    statAvgClose: ims.typedElement("stat_avg_close", HTMLElement),
    statAvgCloseN: ims.typedElement("stat_avg_close_n", HTMLElement),
    areaTableBody: ims.typedElement("area_table_body", HTMLElement),
    areaRowTemplate: ims.typedElement("area_row_template", HTMLTemplateElement),
    followupsCount: ims.typedElement("followups_count", HTMLElement),
    followupsTableBody: ims.typedElement("followups_table_body", HTMLElement),
    followupRowTemplate: ims.typedElement("followup_row_template", HTMLTemplateElement),
    followupsEmpty: ims.typedElement("followups_empty", HTMLElement),
    refreshButton: ims.typedElement("refresh_button", HTMLButtonElement),
    autoRefreshInterval: ims.typedElement("auto_refresh_interval", HTMLSelectElement),
    lastUpdated: ims.typedElement("last_updated", HTMLElement),
};

// Remembers the chosen auto-refresh cadence (seconds; "0" = off) across visits.
const autoRefreshKey = "dashboard_auto_refresh_seconds";

// A small categorical palette, reused across charts.
const palette: string[] = [
    "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2",
    "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

// Chart instances, created once and updated in place on each refresh so only the
// data that changed animates — instead of destroying and recreating every canvas
// (which repaints the whole dashboard). Keyed by canvas id.
const charts = new Map<string, any>();

// The previous render's metrics, used to detect which pieces changed so only
// those cards get a transient highlight "glow". Null until the first render,
// which establishes the baseline and never glows.
let prev: Metrics|null = null;

initDashboard();

async function initDashboard(): Promise<void> {
    const {authInfo} = await ims.commonPageInit();
    if (!authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    // Read the event from the path *after* commonPageInit() has populated pathIds.
    const eventName: string|null = ims.pathIds.eventName;
    if (eventName == null) {
        ims.setErrorMessage("No event selected.");
        ims.hideLoadingOverlay();
        return;
    }
    // The dashboard opens to admins and per-event writers (plan 52d). A writer gets
    // writeIncidents on this event; admins get it everywhere. This is the single
    // permission seam a future role swaps in (docs/plans/70-dashboards.md).
    const mayView = authInfo.admin || (authInfo.event_access?.[eventName]?.writeIncidents ?? false);
    if (!mayView) {
        ims.setErrorMessage("The dashboard is restricted to administrators and event writers.");
        ims.hideLoadingOverlay();
        return;
    }

    // Manual refresh.
    el.refreshButton.addEventListener("click", () => void loadMetrics());
    // Auto-refresh: restore the saved cadence and (re)arm the timer on change.
    el.autoRefreshInterval.value = localStorage.getItem(autoRefreshKey) ?? "0";
    el.autoRefreshInterval.addEventListener("change", () => {
        localStorage.setItem(autoRefreshKey, el.autoRefreshInterval.value);
        applyAutoRefresh();
    });
    applyAutoRefresh();

    await loadMetrics();
    ims.hideLoadingOverlay();
}

// loadMetrics fetches the (server-cached) aggregate and redraws. Used for the
// initial load, the Refresh button, and each auto-refresh tick.
let refreshing = false;
async function loadMetrics(): Promise<void> {
    if (refreshing) {
        return;
    }
    refreshing = true;
    el.refreshButton.disabled = true;
    try {
        const {json, err} = await ims.fetchNoThrow<Metrics>(
            ims.urlReplace(url_metrics), {headers: {"Cache-Control": "no-cache"}},
        );
        if (err != null || json == null) {
            const message = "Failed to load metrics:\n" + err;
            console.error(message);
            ims.setErrorMessage(message);
            return;
        }
        ims.clearErrorMessage();
        render(json);
        // Show the time of THIS fetch so the label visibly ticks on every
        // (auto-)refresh. The data itself may be served from the server's
        // per-event cache (up to ~1 min old); surface that true age on hover.
        el.lastUpdated.textContent = "Last updated: " + ims.longFormatDate(Date.now());
        el.lastUpdated.title = "Data computed: " + ims.longFormatDate(json.generated_at_ms);
    } finally {
        el.refreshButton.disabled = false;
        refreshing = false;
    }
}

// applyAutoRefresh (re)arms the polling timer from the dropdown selection. "0"
// (Off) clears it. The cadence matches the server cache TTL, so most ticks are
// served from cache without a database hit.
let autoRefreshTimer: number = 0;
function applyAutoRefresh(): void {
    if (autoRefreshTimer !== 0) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = 0;
    }
    const seconds = parseInt(el.autoRefreshInterval.value, 10);
    if (seconds > 0) {
        autoRefreshTimer = setInterval(() => void loadMetrics(), seconds * 1000);
    }
}

function render(m: Metrics): void {
    // Charts inherit the page's text color so they stay legible in dark mode.
    if (typeof Chart !== "undefined") {
        Chart.defaults.color = getComputedStyle(document.body).color;
    }

    const p = prev;
    const first = p == null;

    // Headline counts.
    el.statTotal.textContent = m.total.toString();
    el.statOpen.textContent = m.open.toString();
    el.statClosed.textContent = m.closed.toString();
    el.statAvgClose.textContent =
        m.avg_time_to_close_seconds == null ? "—" : formatDuration(m.avg_time_to_close_seconds);
    el.statAvgCloseN.textContent = m.closed_count.toString();

    // Charts: created on the first render, updated in place thereafter.
    doughnut("chart_state", m.by_state);
    bar("chart_priority", m.by_priority, "Incidents");
    doughnut("chart_category", m.by_category);
    bar("chart_type", m.by_type, "Incidents", "y");
    bar("chart_area", m.by_area, "Incidents", "y");
    line("chart_byday", m.by_day);

    // Tables.
    drawAreaTable(m.by_area);
    drawFollowUps(m.open_follow_ups);

    // Glow only the cards whose data actually changed — and never on the first
    // render (everything is "new" then, which would light up the whole page).
    if (!first) {
        if (p.total !== m.total) {
            glowCard("stat_total");
        }
        if (p.open !== m.open) {
            glowCard("stat_open");
        }
        if (p.closed !== m.closed) {
            glowCard("stat_closed");
        }
        if (p.avg_time_to_close_seconds !== m.avg_time_to_close_seconds
            || p.closed_count !== m.closed_count) {
            glowCard("stat_avg_close");
        }
        if (diff(p.by_state, m.by_state)) {
            glowCard("chart_state");
        }
        if (diff(p.by_priority, m.by_priority)) {
            glowCard("chart_priority");
        }
        if (diff(p.by_category, m.by_category)) {
            glowCard("chart_category");
        }
        if (diff(p.by_type, m.by_type)) {
            glowCard("chart_type");
        }
        if (diff(p.by_area, m.by_area)) {
            glowCard("chart_area");
            glowCard("area_table_body");
        }
        if (diff(p.by_day, m.by_day)) {
            glowCard("chart_byday");
        }
        if (diff(p.open_follow_ups, m.open_follow_ups)) {
            glowCard("followups_table_body");
        }
    }

    prev = m;
}

// diff reports whether two metric pieces differ, by value. The arrays are small
// and serialize deterministically (fixed field order), so a stringify compare is
// both correct and cheap here.
function diff(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) !== JSON.stringify(b);
}

// glowCard briefly highlights the Bootstrap card enclosing the element `id`. The
// class is removed when the animation ends so it can re-fire on a later refresh.
function glowCard(id: string): void {
    const card = document.getElementById(id)?.closest(".card");
    if (card == null) {
        return;
    }
    card.classList.remove("glow-changed");
    // Force a reflow so re-adding the class restarts the animation.
    void (card as HTMLElement).offsetWidth;
    card.classList.add("glow-changed");
    card.addEventListener(
        "animationend", () => card.classList.remove("glow-changed"), {once: true},
    );
}

// makeChart creates a chart on its first call for a canvas and, on every later
// call, updates that same instance in place (swapping in the new data and
// animating only the delta) instead of recreating it.
function makeChart(canvasId: string, config: {type: string; data: object; options: object}): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement|null;
    if (canvas == null || typeof Chart === "undefined") {
        return;
    }
    const existing = charts.get(canvasId);
    if (existing != null) {
        existing.data = config.data;
        existing.update();
        return;
    }
    charts.set(canvasId, new Chart(canvas, config));
}

function doughnut(canvasId: string, buckets: MetricCount[]): void {
    makeChart(canvasId, {
        type: "doughnut",
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                data: buckets.map(b => b.count),
                backgroundColor: buckets.map((_b, i) => palette[i % palette.length]),
            }],
        },
        options: {
            responsive: true,
            plugins: {legend: {position: "right"}},
        },
    });
}

function bar(canvasId: string, buckets: MetricCount[], label: string, indexAxis: "x"|"y" = "x"): void {
    makeChart(canvasId, {
        type: "bar",
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: label,
                data: buckets.map(b => b.count),
                backgroundColor: palette[0],
            }],
        },
        options: {
            responsive: true,
            indexAxis: indexAxis,
            plugins: {legend: {display: false}},
            scales: {
                x: {ticks: {precision: 0}},
                y: {ticks: {precision: 0}},
            },
        },
    });
}

function line(canvasId: string, days: MetricDay[]): void {
    makeChart(canvasId, {
        type: "line",
        data: {
            labels: days.map(d => d.date),
            datasets: [{
                label: "Incidents",
                data: days.map(d => d.count),
                borderColor: palette[0],
                backgroundColor: palette[0],
                tension: 0.2,
            }],
        },
        options: {
            responsive: true,
            plugins: {legend: {display: false}},
            scales: {y: {beginAtZero: true, ticks: {precision: 0}}},
        },
    });
}

function drawAreaTable(buckets: MetricCount[]): void {
    el.areaTableBody.querySelectorAll("tr").forEach(r => r.remove());
    for (const b of buckets) {
        const frag = el.areaRowTemplate.content.cloneNode(true) as DocumentFragment;
        frag.querySelector(".area-name")!.textContent = b.label;
        frag.querySelector(".area-count")!.textContent = b.count.toString();
        el.areaTableBody.append(frag);
    }
}

function drawFollowUps(refs: MetricIncidentRef[]): void {
    el.followupsCount.textContent = refs.length.toString();
    el.followupsTableBody.querySelectorAll("tr").forEach(r => r.remove());
    for (const ref of refs) {
        const frag = el.followupRowTemplate.content.cloneNode(true) as DocumentFragment;
        const link = frag.querySelector(".followup-link") as HTMLAnchorElement;
        link.textContent = ref.number.toString();
        link.href = ims.urlReplace(url_viewIncidentNumber).replace("<number>", ref.number.toString());
        frag.querySelector(".followup-summary")!.textContent = ref.summary;
        el.followupsTableBody.append(frag);
    }
    el.followupsEmpty.classList.toggle("hidden", refs.length > 0);
}

// formatDuration renders a span of seconds as a compact "Nd Nh Nm" string.
function formatDuration(seconds: number): string {
    const s = Math.round(seconds);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) {
        parts.push(d + "d");
    }
    if (h > 0) {
        parts.push(h + "h");
    }
    if (m > 0 || parts.length === 0) {
        parts.push(m + "m");
    }
    return parts.join(" ");
}
