// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mikeki/ocf-ims/internal/server"
)

func TestHealthCheckSuccess(t *testing.T) {
	t.Parallel()

	// this serves the real endpoint used in the server
	ser := httptest.NewServer(server.AddBasicHandlers(nil))

	exitCode := runHealthCheckInternal(t.Context(), ser.URL)
	if exitCode != 0 {
		t.Errorf("wanted exit code 0, got %v", exitCode)
	}
}

func TestHealthCheckBadStatus(t *testing.T) {
	t.Parallel()

	ser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ims/api/ping" {
			w.WriteHeader(http.StatusTeapot)
			_, _ = w.Write([]byte("ack"))
		}
	}))

	exitCode := runHealthCheckInternal(t.Context(), ser.URL)
	if exitCode != 5 {
		t.Errorf("wanted exit code 5, got %v", exitCode)
	}
}

func TestHealthCheckBadResponse(t *testing.T) {
	t.Parallel()

	ser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// the server returns a 200, but not the expected text ("ack")
		w.WriteHeader(http.StatusOK)
	}))

	exitCode := runHealthCheckInternal(t.Context(), ser.URL)
	if exitCode != 6 {
		t.Errorf("wanted exit code 6, got %v", exitCode)
	}
}
