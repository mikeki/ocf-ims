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
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	incidentapi "github.com/mikeki/ocf-ims/internal/incident"

	personapi "github.com/mikeki/ocf-ims/internal/person"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// profilePictureFilesFor counts the stored attachment files belonging to a person.
// Their server-generated names share a "person_<id>_" prefix, so filtering by that
// isolates this person's files from the parallel suite's shared attachments dir. Used
// to prove that replacing or removing a picture deletes the backing file rather than
// leaving it orphaned.
func profilePictureFilesFor(t *testing.T, personID int64) int {
	t.Helper()
	dir := shared.cfg.AttachmentsStore.Local.Dir.Name()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	prefix := fmt.Sprintf("person_%05d_", personID)
	n := 0
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix) {
			n++
		}
	}
	return n
}

// A minimal valid 1x1 PNG — enough for the server's mimetype sniff to detect
// image/png on the happy path.
var onePixelPNG = mustDecodeBase64(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

func mustDecodeBase64(s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

// uploadProfilePicture POSTs a multipart image to the person's picture endpoint.
func (a ApiHelper) uploadProfilePicture(ctx context.Context, personID int64, fileBytes []byte) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "picture")

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	part, err := writer.CreateFormFile(incidentapi.IMSAttachmentFormKey, "pic-"+rand.NonCryptoText())
	require.NoError(a.t, err)
	_, err = part.Write(fileBytes)
	require.NoError(a.t, err)
	require.NoError(a.t, writer.Close())

	httpPost, err := http.NewRequestWithContext(ctx, http.MethodPost, path.String(), &requestBody)
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpPost.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	if a.referrer != "" {
		httpPost.Header.Set("Referer", a.referrer)
	}
	httpPost.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{Timeout: 10 * time.Second}
	// #nosec G704 // SSRF via taint analysis. We control the URLs.
	resp, err := client.Do(httpPost)
	require.NoError(a.t, err)
	return resp
}

func (a ApiHelper) getProfilePicture(ctx context.Context, personID int64) *http.Response {
	a.t.Helper()
	path := a.serverURL.JoinPath("/ims/api/personnel", strconv.FormatInt(personID, 10), "picture")
	httpGet, err := http.NewRequestWithContext(ctx, http.MethodGet, path.String(), nil)
	require.NoError(a.t, err)
	if a.jwt != "" {
		httpGet.Header.Set("Authorization", "Bearer "+a.jwt)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	// #nosec G704 // SSRF via taint analysis. We control the URLs.
	resp, err := client.Do(httpGet)
	require.NoError(a.t, err)
	return resp
}

// deleteProfilePicture removes a person's picture through the generated Connect client
// (DeletePersonProfilePicture). The REST DELETE /personnel/{personId}/picture route was retired with
// the RPC (plan 09h/1c); the upload + serve stay REST (multipart/binary). The retired endpoint
// answered 204, mirrored by writeRPCStatus.
func (a ApiHelper) deleteProfilePicture(ctx context.Context, personID int64) *http.Response {
	a.t.Helper()
	client := servicev1connect.NewImsServiceClient(http.DefaultClient, a.serverURL.String())
	rpcReq := connect.NewRequest(&servicerpcv1.DeletePersonProfilePictureRequest{PersonId: int32(personID)})
	a.authorizeRPC(rpcReq)
	_, err := client.DeletePersonProfilePicture(ctx, rpcReq)
	return writeRPCStatus(err)
}

// TestPersonProfilePicture covers the profile-picture lifecycle: an admin uploads an
// image and it becomes visible on the profile card; non-images are rejected; a
// non-admin may view but not upload; and removal clears both the URL and the served
// bytes.
func TestPersonProfilePicture(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)}

	// Create a plain registry person (no login needed) to hang a picture on.
	handle := "PicPerson" + rand.NonCryptoText()
	resp := admin.createPerson(ctx, personapi.CreatePersonRequest{Handle: handle})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created imsjson.Person
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.NoError(t, resp.Body.Close())
	personID := created.PersonID

	// No picture yet: the card omits the URL and the serve endpoint 404s.
	people, resp := admin.getPersonnelByID(ctx, personID, "")
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	require.Nil(t, people[0].ProfilePictureURL)
	resp = admin.getProfilePicture(ctx, personID)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A non-image upload is rejected.
	resp = admin.uploadProfilePicture(ctx, personID, []byte("this is plainly not an image, just some text"))
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// An over-large upload is rejected up front (413), before the image check — the
	// bytes here exceed the per-picture cap but stay under the global request limit.
	resp = admin.uploadProfilePicture(ctx, personID, make([]byte, 11<<20))
	require.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A non-admin may not upload (upload rights == person-edit rights == admin).
	resp = alice.uploadProfilePicture(ctx, personID, onePixelPNG)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The admin uploads a valid PNG.
	resp = admin.uploadProfilePicture(ctx, personID, onePixelPNG)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Exactly one file is now stored for this person.
	require.Equal(t, 1, profilePictureFilesFor(t, personID))

	// Uploading a replacement deletes the previous file rather than orphaning it: the
	// person still has exactly one stored picture, not two.
	resp = admin.uploadProfilePicture(ctx, personID, onePixelPNG)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, 1, profilePictureFilesFor(t, personID))

	// The card now advertises the picture URL...
	people, resp = admin.getPersonnelByID(ctx, personID, "")
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	require.NotNil(t, people[0].ProfilePictureURL)

	// ...and any logged-in viewer (here a non-admin) can fetch the image bytes.
	resp = alice.getProfilePicture(ctx, personID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, "image/png", resp.Header.Get("Content-Type"))
	require.NoError(t, resp.Body.Close())

	// A non-admin may not remove it.
	resp = alice.deleteProfilePicture(ctx, personID)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// The admin removes it: the URL is gone, the bytes 404 again, and the backing file
	// is deleted (not just the pointer cleared).
	resp = admin.deleteProfilePicture(ctx, personID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, 0, profilePictureFilesFor(t, personID))

	people, resp = admin.getPersonnelByID(ctx, personID, "")
	require.NoError(t, resp.Body.Close())
	require.Len(t, people, 1)
	require.Nil(t, people[0].ProfilePictureURL)
	resp = admin.getProfilePicture(ctx, personID)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
