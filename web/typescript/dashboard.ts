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
};

// A small categorical palette, reused across charts.
const palette: string[] = [
    "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2",
    "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

const eventName: string|null = ims.pathIds.eventName;

initDashboard();

async function initDashboard(): Promise<void> {
    const {authInfo} = await ims.commonPageInit();
    if (!authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    // Admin-only for now (the refine-later permission seam, docs/plans/70-dashboards.md).
    // This single check is the one line a future role swaps in.
    if (!authInfo.admin) {
        ims.setErrorMessage("The dashboard is restricted to administrators.");
        ims.hideLoadingOverlay();
        return;
    }
    if (eventName == null) {
        ims.setErrorMessage("No event selected.");
        ims.hideLoadingOverlay();
        return;
    }

    const {json, err} = await ims.fetchNoThrow<Metrics>(
        ims.urlReplace(url_metrics), {headers: {"Cache-Control": "no-cache"}},
    );
    if (err != null || json == null) {
        const message = "Failed to load metrics:\n" + err;
        console.error(message);
        ims.setErrorMessage(message);
        ims.hideLoadingOverlay();
        return;
    }

    render(json);
    ims.hideLoadingOverlay();
}

function render(m: Metrics): void {
    // Charts inherit the page's text color so they stay legible in dark mode.
    if (typeof Chart !== "undefined") {
        Chart.defaults.color = getComputedStyle(document.body).color;
    }

    el.statTotal.textContent = m.total.toString();
    el.statOpen.textContent = m.open.toString();
    el.statClosed.textContent = m.closed.toString();
    el.statAvgClose.textContent =
        m.avg_time_to_close_seconds == null ? "—" : formatDuration(m.avg_time_to_close_seconds);
    el.statAvgCloseN.textContent = m.closed_count.toString();

    doughnut("chart_state", m.by_state);
    bar("chart_priority", m.by_priority, "Incidents");
    doughnut("chart_category", m.by_category);
    bar("chart_type", m.by_type, "Incidents", "y");
    bar("chart_area", m.by_area, "Incidents", "y");
    line("chart_byday", m.by_day);

    drawAreaTable(m.by_area);
    drawFollowUps(m.open_follow_ups);
}

function makeChart(canvasId: string, config: object): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement|null;
    if (canvas == null || typeof Chart === "undefined") {
        return;
    }
    new Chart(canvas, config);
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
