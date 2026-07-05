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

package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"testing"
	"time"

	"github.com/mikeki/ocf-ims/api"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// setOwnProfile POSTs a self-service profile edit (the caller edits themselves).
func (a ApiHelper) setOwnProfile(ctx context.Context, body api.SetOwnProfileRequest) *http.Response {
	a.t.Helper()
	return a.imsPost(ctx, body, a.serverURL.JoinPath("/ims/api/auth/profile").String())
}

// uploadOwnPicture POSTs a multipart image to the self-service picture endpoint.
func (a ApiHelper) uploadOwnPicture(ctx context.Context, fileBytes []byte) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/auth/picture").String()

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	part, err := writer.CreateFormFile(api.IMSAttachmentFormKey, "pic-"+rand.NonCryptoText())
	require.NoError(a.t, err)
	_, err = part.Write(fileBytes)
	require.NoError(a.t, err)
	require.NoError(a.t, writer.Close())

	httpPost, err := http.NewRequestWithContext(ctx, http.MethodPost, path, &requestBody)
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpPost.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	httpPost.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{Timeout: 10 * time.Second}
	// #nosec G704 // SSRF via taint analysis. We control the URLs.
	resp, err := client.Do(httpPost)
	require.NoError(a.t, err)
	return resp
}

func (a ApiHelper) deleteOwnPicture(ctx context.Context) *http.Response {
	a.t.Helper()
	_, resp := a.imsDelete(ctx, a.serverURL.JoinPath("/ims/api/auth/picture").String(), nil)
	return resp
}

// TestSelfProfile covers the self-service profile endpoints: an authenticated
// non-admin edits their OWN identity/contact fields and profile picture, sees their
// own contact info on their card (which a non-admin can't see for others), and an
// unauthenticated caller is refused. A dedicated login-capable person is created (not
// the shared Alice fixture) so this parallel test never mutates another test's user.
func TestSelfProfile(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	noAuth := ApiHelper{t: t, serverURL: shared.serverURL, jwt: ""}

	uniq := func(prefix string) string { return prefix + rand.NonCryptoText() }
	handle := uniq("Selfie")
	email := handle + "@example.com"
	const password = "selfie-password-123"

	resp := admin.createPerson(ctx, api.CreatePersonRequest{
		Handle: handle, Email: email, Password: password,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.NoError(t, resp.Body.Close())
	require.Positive(t, created.PersonID)

	// Log in as the new person (by email) to get their own JWT.
	statusCode, _, token := noAuth.postAuth(ctx, api.PostAuthRequest{Identification: email, Password: password})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)
	self := ApiHelper{t: t, serverURL: shared.serverURL, jwt: token}

	// --- Unauthenticated cannot self-edit. ---
	resp = noAuth.setOwnProfile(ctx, api.SetOwnProfileRequest{})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- Self-edit succeeds; the change is resolved from the JWT (no path id). ---
	newName := "Self Edited Name"
	newPhone := "555-0199"
	resp = self.setOwnProfile(ctx, api.SetOwnProfileRequest{Name: &newName, Phone: &newPhone})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The person's own card reflects the edit AND reveals their contact info to
	// themselves — even though they are not a personnel admin.
	people, resp := self.getPersonnelByID(ctx, created.PersonID, "")
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	require.Equal(t, newName, people[0].Name)
	require.Equal(t, newPhone, people[0].Phone)
	require.Equal(t, email, people[0].Email, "a person sees their own email")
	require.False(t, people[0].IsAdmin)

	// The contact gate still holds for OTHER people: this non-admin viewing the admin's
	// card gets identity but no email/phone.
	others, resp := self.getPersonnelByID(ctx, userAdminPersonID, "")
	require.NoError(t, resp.Body.Close())
	require.Len(t, others, 1)
	require.Empty(t, others[0].Email, "a non-admin does not see another person's email")
	require.Empty(t, others[0].Phone, "a non-admin does not see another person's phone")

	// --- Self picture: no picture → non-image rejected → upload → visible → remove. ---
	resp = self.getProfilePicture(ctx, created.PersonID)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	resp = self.uploadOwnPicture(ctx, []byte("plainly not an image"))
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	resp = self.uploadOwnPicture(ctx, onePixelPNG)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp = self.getPersonnelByID(ctx, created.PersonID, "")
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	require.NotNil(t, people[0].ProfilePictureURL)

	resp = self.getProfilePicture(ctx, created.PersonID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, "image/png", resp.Header.Get("Content-Type"))
	require.NoError(t, resp.Body.Close())

	resp = self.deleteOwnPicture(ctx)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	people, resp = self.getPersonnelByID(ctx, created.PersonID, "")
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	require.Nil(t, people[0].ProfilePictureURL)
}
