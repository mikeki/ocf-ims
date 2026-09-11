// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"strconv"
	"sync/atomic"

	"github.com/launchdarkly/eventsource"
)

const EventSourceChannel = "imsevents"

type IMSEventData struct {
	EventID int32  `json:"event_id,omitzero"`
	Comment string `json:"comment,omitzero"`

	// Exactly one of IncidentNumber, UpdateAllIncidents, ReportNumber, VisitNumber,
	// or InitialEvent must be set, as this indicates the type of IMS SSE.

	IncidentNumber int32 `json:"incident_number,omitzero"`
	// UpdateAllIncidents is the privacy-redacted form of an incident poke (plan 09 §6
	// M8): when the changed incident is PRIVATE, the stream deliberately omits its
	// number and instead tells subscribers "some incident in this event changed —
	// reload". Clients re-fetch the incident list through the gated API, so a viewer
	// who may not see the private incident learns nothing identifying (its existence
	// and number never cross the wire). It routes as an "Incident" SSE and marshals as
	// `update_all`, which the web client already treats as a full gated reload. The
	// residual (that *some* activity happened in the event) is the accepted boundary
	// until the SSE stream becomes a per-subscriber-filtered Connect stream (Phase 3).
	UpdateAllIncidents bool  `json:"update_all,omitzero"`
	ReportNumber       int32 `json:"report_number,omitzero"`
	VisitNumber        int32 `json:"visit_number,omitzero"`
	InitialEvent       bool  `json:"initial_event,omitzero"`
}

type IMSEvent struct {
	EventID   int64
	EventData IMSEventData
}

func (e IMSEvent) Id() string {
	return strconv.FormatInt(e.EventID, 10)
}

func (e IMSEvent) Event() string {
	if e.EventData.IncidentNumber > 0 || e.EventData.UpdateAllIncidents {
		return "Incident"
	}
	if e.EventData.ReportNumber > 0 {
		return "Report"
	}
	if e.EventData.VisitNumber > 0 {
		return "Visit"
	}
	if e.EventData.InitialEvent {
		return "InitialEvent"
	}
	return "UnknownEvent"
}

func (e IMSEvent) Data() string {
	b, err := json.Marshal(e.EventData)
	if err != nil {
		slog.Error("Error converting IMSEvent to JSON", "EventData", e.EventData, "err", err)
	}
	return string(b)
}

// IncidentPrivacyOracle reports whether an incident is PRIVATE, so the stream can
// redact its number before broadcasting (see IMSEventData.UpdateAllIncidents). It is
// injected as a function (rather than a store dependency) to keep internal/server a
// leaf package; the wiring layer builds it from the IMS DB.
type IncidentPrivacyOracle func(ctx context.Context, eventID, incidentNumber int32) (bool, error)

type EventSourcerer struct {
	Server    *eventsource.Server
	IdCounter atomic.Int64
	// Watch is the second publisher (plan 09p 3b.0b), fed from the Notify*
	// methods below so no call site changed (S7). Nil means no stream is
	// attached; every Publish is nil-safe.
	Watch *WatchHub

	// incidentIsPrivate is consulted before every incident poke. It is required (see
	// NewEventSourcerer): the constructor takes it explicitly rather than defaulting,
	// so a miswired server can never silently broadcast private incident numbers.
	incidentIsPrivate IncidentPrivacyOracle
}

// NewEventSourcerer builds the SSE hub. incidentIsPrivate must be non-nil — it is how
// NotifyIncidentUpdate decides whether to broadcast an incident's number or the
// redacted "reload" poke (IMSEventData.UpdateAllIncidents). Passing nil is a
// programming error and panics, so a miswired server fails loudly at startup rather
// than silently leaking private incident numbers.
func NewEventSourcerer(incidentIsPrivate IncidentPrivacyOracle) *EventSourcerer {
	if incidentIsPrivate == nil {
		panic("NewEventSourcerer: incidentIsPrivate oracle must not be nil")
	}
	es := &EventSourcerer{
		Server:            eventsource.NewServer(),
		IdCounter:         atomic.Int64{},
		incidentIsPrivate: incidentIsPrivate,
	}
	es.Server.Register(EventSourceChannel, es)
	es.Server.ReplayAll = true
	return es
}

func (es *EventSourcerer) Replay(channel, id string) chan eventsource.Event {
	if channel != EventSourceChannel {
		return nil
	}
	out := make(chan eventsource.Event, 1)
	out <- IMSEvent{
		EventID: es.IdCounter.Load(),
		EventData: IMSEventData{
			InitialEvent: true,
			Comment:      "The most recent SSE ID is provided in this message",
		},
	}
	close(out)
	return out
}

func (es *EventSourcerer) NotifyReportUpdate(eventID int32, reportNumber int32) {
	if reportNumber == 0 {
		return
	}
	es.Server.Publish([]string{EventSourceChannel}, IMSEvent{
		EventID: es.IdCounter.Add(1),
		EventData: IMSEventData{
			EventID:      eventID,
			ReportNumber: reportNumber,
		},
	})
	es.Watch.Publish(Poke{EventID: eventID, ReportNumber: reportNumber})
}

func (es *EventSourcerer) NotifyIncidentUpdate(ctx context.Context, eventID int32, incidentNumber int32) {
	if incidentNumber == 0 {
		return
	}
	es.Server.Publish([]string{EventSourceChannel}, IMSEvent{
		EventID:   es.IdCounter.Add(1),
		EventData: es.incidentEventData(ctx, eventID, incidentNumber),
	})
	// Unredacted: the stream filters per subscriber at send time.
	es.Watch.Publish(Poke{EventID: eventID, IncidentNumber: incidentNumber})
}

func (es *EventSourcerer) NotifyIncidentUpdates(ctx context.Context, eventID int32, incident1, incident2 int32) {
	es.NotifyIncidentUpdate(ctx, eventID, incident1)
	if incident2 != incident1 {
		es.NotifyIncidentUpdate(ctx, eventID, incident2)
	}
}

// NotifyVisitUpdate publishes no stream poke: the contract has no visit poke
// kind (Visits are off, #61). Add the kind and the Publish together.
func (es *EventSourcerer) NotifyVisitUpdate(eventID int32, visitNumber int32) {
	if visitNumber == 0 {
		return
	}
	es.Server.Publish([]string{EventSourceChannel}, IMSEvent{
		EventID: es.IdCounter.Add(1),
		EventData: IMSEventData{
			EventID:     eventID,
			VisitNumber: visitNumber,
		},
	})
}

// incidentEventData builds the payload for an incident poke, redacting the number
// when the incident is private (IMSEventData.UpdateAllIncidents). On an oracle error
// it fails SAFE — redacting — so a lookup failure never leaks a private number.
//
// The oracle runs on a context detached from the request's cancellation: the poke is
// published after the write has committed, and if the writing client has already
// disconnected the request ctx is cancelled — the lookup would then fail and the
// fail-safe would turn a targeted poke into an update_all full reload for every
// subscriber. The values (request id, claims) are kept; only cancellation is dropped.
func (es *EventSourcerer) incidentEventData(ctx context.Context, eventID, incidentNumber int32) IMSEventData {
	private, err := es.incidentIsPrivate(context.WithoutCancel(ctx), eventID, incidentNumber)
	if err != nil {
		slog.Error("SSE incident-privacy lookup failed; redacting the poke to be safe",
			"eventID", eventID, "incidentNumber", incidentNumber, "err", err)
		private = true
	}
	if private {
		return IMSEventData{EventID: eventID, UpdateAllIncidents: true}
	}
	return IMSEventData{EventID: eventID, IncidentNumber: incidentNumber}
}
