// SPDX-License-Identifier: Apache-2.0

package herr

import "net/http"

// WriteOKResponse writes a status 200 (OK) HTTP response with a text/plain body.
func WriteOKResponse(w http.ResponseWriter, text string) {
	http.Error(w, text, http.StatusOK)
}

// WriteNoContentResponse writes a status 204 (No Content) HTTP response with a text/plain body.
func WriteNoContentResponse(w http.ResponseWriter, text string) {
	http.Error(w, text, http.StatusNoContent)
}

// WriteCreatedResponse writes a status 201 (Created) HTTP response with a text/plain body.
func WriteCreatedResponse(w http.ResponseWriter, text string) {
	http.Error(w, text, http.StatusCreated)
}
