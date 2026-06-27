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

// IMS service worker (plan 84). Its sole job today is web push: receive a push
// message from the browser's push service and turn it into an OS notification,
// then route a click to the right IMS page. It is served from /ims/sw.js so its
// scope is the whole /ims/ tree (see web/mux.go), which lets notificationclick
// focus any open IMS tab. Nothing is cached or intercepted here — this is not an
// offline worker.

// The project tsconfig compiles page scripts with the DOM lib, not the WebWorker
// lib, so we declare the handful of worker globals we touch rather than pull in a
// conflicting lib that would clash with the DOM types.
interface PushPayload {
    title?: string;
    body?: string;
    url?: string;
}
interface NotificationData {
    url: string;
}
interface ShowNotificationOptions {
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    renotify?: boolean;
    data?: NotificationData;
}
interface SWClient {
    url: string;
    focus(): Promise<SWClient>;
    navigate(url: string): Promise<SWClient|null>;
}
interface SWExtendableEvent {
    waitUntil(p: Promise<unknown>): void;
}
interface SWPushEvent extends SWExtendableEvent {
    data: {json(): unknown; text(): string}|null;
}
interface SWNotificationEvent extends SWExtendableEvent {
    notification: {close(): void; data: NotificationData|null};
}
interface SWGlobal {
    addEventListener(type: "install", listener: (e: SWExtendableEvent) => void): void;
    addEventListener(type: "activate", listener: (e: SWExtendableEvent) => void): void;
    addEventListener(type: "push", listener: (e: SWPushEvent) => void): void;
    addEventListener(type: "notificationclick", listener: (e: SWNotificationEvent) => void): void;
    registration: {showNotification(title: string, options?: ShowNotificationOptions): Promise<void>};
    clients: {
        matchAll(opts?: {type?: string; includeUncontrolled?: boolean}): Promise<SWClient[]>;
        openWindow(url: string): Promise<SWClient|null>;
        claim(): Promise<void>;
    };
    skipWaiting(): Promise<void>;
}

const sw = self as unknown as SWGlobal;

const defaultUrl = "/ims/app/";
const iconUrl = "/ims/static/logos/android-chrome-192x192.png";
const badgeUrl = "/ims/static/logos/favicon-32x32.png";

sw.addEventListener("install", function(event: SWExtendableEvent): void {
    // Become the active worker without waiting for old tabs to close, so a fresh
    // subscribe right after first load works immediately.
    event.waitUntil(sw.skipWaiting());
});

sw.addEventListener("activate", function(event: SWExtendableEvent): void {
    // Take control of pages that were already open when this worker activated.
    event.waitUntil(sw.clients.claim());
});

sw.addEventListener("push", function(event: SWPushEvent): void {
    let payload: PushPayload = {};
    if (event.data) {
        try {
            payload = event.data.json() as PushPayload;
        } catch {
            // A non-JSON payload is treated as a bare body.
            payload = {body: event.data.text()};
        }
    }
    const title = payload.title || "OCF IMS";
    const url = payload.url || defaultUrl;
    event.waitUntil(sw.registration.showNotification(title, {
        body: payload.body || "",
        icon: iconUrl,
        badge: badgeUrl,
        // Collapse repeat notifications about the same thing onto one another.
        tag: url,
        renotify: true,
        data: {url: url},
    }));
});

sw.addEventListener("notificationclick", function(event: SWNotificationEvent): void {
    event.notification.close();
    const target = event.notification.data?.url || defaultUrl;
    event.waitUntil((async function(): Promise<void> {
        const windows = await sw.clients.matchAll({type: "window", includeUncontrolled: true});
        // Reuse an open IMS tab if there is one: focus it, and point it at the
        // target page if it's somewhere else.
        for (const client of windows) {
            if (client.url.includes("/ims/")) {
                await client.focus();
                if (client.navigate && !client.url.endsWith(target)) {
                    try {
                        await client.navigate(target);
                    } catch {
                        // navigate is best-effort; the focus already happened.
                    }
                }
                return;
            }
        }
        await sw.clients.openWindow(target);
    })());
});
