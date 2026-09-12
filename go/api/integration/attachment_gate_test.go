// SPDX-License-Identifier: Apache-2.0

package integration_test

import (
	"net/http"
	"testing"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
)

// The incident upload route carries the same gate as UpdateIncident (plan 09s, 3b.4a): a
// 52f grantee may attach (an upload is journal-only by construction), a plain reporter may
// not, and a private incident the caller may not view answers 404 rather than taking an
// entry. The read side also reports the sniffed media type.
func TestAttachFileToIncident_GrantAndPrivacy(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	admin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}
	alice := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAlice(t, ctx)} // creator (writer)
	erin := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForErin(t, ctx)}   // another writer
	dave := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForDave(t, ctx)}   // reporter (to be granted)

	eventName := rand.NonCryptoText()
	_, resp := admin.createEvent(ctx, imsjson.Event{Name: &eventName})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	for _, handle := range []string{userAliceHandle, userErinHandle} {
		resp = admin.addWriter(ctx, eventName, handle)
		require.Equal(t, http.StatusNoContent, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}
	resp = admin.addReporter(ctx, eventName, userDaveHandle)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	num := alice.newIncidentSuccess(ctx, imsjson.Incident{Event: eventName, Summary: new("photo op")})

	// A PNG signature is enough for the sniffer; the rest is padding.
	png := append([]byte("\x89PNG\r\n\x1a\n"), []byte("not really a picture")...)

	// A plain reporter (no grant) may not upload.
	_, resp = dave.attachFileToIncident(ctx, eventName, num, png)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// A writer may not upload to an incident that does not exist (404, as the read).
	_, resp = alice.attachFileToIncident(ctx, eventName, num+1000, png)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	// Granted, the reporter uploads and reads back both the bytes and the entry.
	resp = alice.attachPersonToIncidentBody(ctx, eventName, num, userDavePersonID,
		imsjson.IncidentPerson{GrantedAccess: true})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	reID, resp := dave.attachFileToIncident(ctx, eventName, num, png)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Positive(t, reID)

	got, resp := dave.getIncidentAttachment(ctx, eventName, num, reID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, png, got)

	incident, resp := dave.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	var entry *imsjson.JournalEntry
	for i := range incident.JournalEntries {
		if incident.JournalEntries[i].ID == reID {
			entry = &incident.JournalEntries[i]
		}
	}
	require.NotNil(t, entry, "the upload's entry is on the incident")
	require.NotEmpty(t, entry.Attachment.Name)
	require.True(t, entry.Attachment.Previewable)
	require.Equal(t, "image/png", entry.Attachment.MediaType)

	// Bytes the sniffer cannot place are reported as octet-stream and not previewable.
	junkID, resp := alice.attachFileToIncident(ctx, eventName, num, []byte{0x00, 0x01, 0x02, 0x03})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	incident, resp = alice.getIncident(ctx, eventName, num)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	for _, je := range incident.JournalEntries {
		if je.ID == junkID {
			require.False(t, je.Attachment.Previewable)
			require.Equal(t, "application/octet-stream", je.Attachment.MediaType)
		}
	}

	// Private: the creator, an admin and the grantee still upload; another writer is told 404.
	resp = alice.updateIncident(ctx, eventName, num, imsjson.Incident{
		Event: eventName, Number: num, Private: new(true),
	})
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	require.NoError(t, resp.Body.Close())

	_, resp = erin.attachFileToIncident(ctx, eventName, num, png)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	for _, api := range []ApiHelper{alice, admin, dave} {
		_, resp = api.attachFileToIncident(ctx, eventName, num, png)
		require.Equal(t, http.StatusNoContent, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}
}
