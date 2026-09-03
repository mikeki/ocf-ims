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

	"connectrpc.com/connect"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	incidentapi "github.com/mikeki/ocf-ims/internal/incident"

	authapi "github.com/mikeki/ocf-ims/internal/auth"
	personapi "github.com/mikeki/ocf-ims/internal/person"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// updateOwnProfile edits the caller's own identity/contact fields through the generated Connect
// client (UpdateOwnProfile). The REST POST /ims/api/auth/profile endpoint was retired when the RPC
// was extracted (plan 09h/1c); the caller is resolved from the JWT, never a path/field. Each field
// is optional (nil = leave unchanged). The retired endpoint returned 204 on success, mirrored by
// the synthesized *http.Response (else connectStatus(err)), so the call sites' assertions hold.
func (a ApiHelper) updateOwnProfile(ctx context.Context, req *servicerpcv1.UpdateOwnProfileRequest) *http.Response {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(req)
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.UpdateOwnProfile(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
}

// uploadOwnPicture POSTs a multipart image to the self-service picture endpoint.
func (a ApiHelper) uploadOwnPicture(ctx context.Context, fileBytes []byte) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/auth/picture").String()

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	part, err := writer.CreateFormFile(incidentapi.IMSAttachmentFormKey, "pic-"+rand.NonCryptoText())
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

// deleteOwnPicture removes the caller's own profile picture through the generated Connect client
// (DeleteOwnProfilePicture). The REST DELETE /ims/api/auth/picture endpoint was retired when the
// RPC was extracted (plan 09h/1c); the picture *upload* (POST /auth/picture) stays multipart REST.
// The retired endpoint returned 204 on success, mirrored by the synthesized *http.Response (else
// connectStatus(err)).
func (a ApiHelper) deleteOwnPicture(ctx context.Context) *http.Response {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.DeleteOwnProfilePictureRequest{})
	if a.jwt != "" {
		rpcReq.Header().Set("Authorization", "Bearer "+a.jwt)
	}
	_, err := client.DeleteOwnProfilePicture(ctx, rpcReq)
	status := http.StatusNoContent
	if err != nil {
		status = connectStatus(err)
	}
	return &http.Response{StatusCode: status, Body: http.NoBody}
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

	resp := admin.createPerson(ctx, personapi.CreatePersonRequest{
		Handle: handle, Email: email, Password: password,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.NoError(t, resp.Body.Close())
	require.Positive(t, created.PersonID)

	// Log in as the new person (by email) to get their own JWT.
	statusCode, _, token := noAuth.postAuth(ctx, authapi.PostAuthRequest{Identification: email, Password: password})
	require.Equal(t, http.StatusOK, statusCode)
	require.NotEmpty(t, token)
	self := ApiHelper{t: t, serverURL: shared.serverURL, jwt: token}

	// --- Unauthenticated cannot self-edit. ---
	resp = noAuth.updateOwnProfile(ctx, &servicerpcv1.UpdateOwnProfileRequest{})
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// --- Self-edit succeeds; the change is resolved from the JWT (no path id). ---
	newName := "Self Edited Name"
	newPhone := "555-0199"
	resp = self.updateOwnProfile(ctx, &servicerpcv1.UpdateOwnProfileRequest{Name: &newName, Phone: &newPhone})
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
