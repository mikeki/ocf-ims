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
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/rand"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

func TestCreateIncidentTypes(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	// Make three new incident types
	typeA, typeB, typeC := rand.NonCryptoText(), rand.NonCryptoText(), rand.NonCryptoText()
	typeAID, resp := apis.editType(ctx, imsjson.IncidentType{Name: &typeA})
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, typeAID)
	typeBID, resp := apis.editType(ctx, imsjson.IncidentType{Name: &typeB})
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, typeBID)
	typeCID, resp := apis.editType(ctx, imsjson.IncidentType{Name: &typeC})
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, typeCID)

	// All three types should now be retrievable and non-hidden
	typesResp, resp := apis.getTypes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeAID, Name: &typeA, Hidden: new(false)})
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeBID, Name: &typeB, Hidden: new(false)})
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeCID, Name: &typeC, Hidden: new(false)})

	// Hide one of those types
	hideOne := imsjson.IncidentType{ID: *typeAID, Hidden: new(true)}
	_, resp = apis.editType(ctx, hideOne)
	require.NoError(t, resp.Body.Close())

	// That type should now be hidden
	typesResp, resp = apis.getTypes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeAID, Name: &typeA, Hidden: new(true)})
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeBID, Name: &typeB, Hidden: new(false)})
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeCID, Name: &typeC, Hidden: new(false)})

	// Unhide that type we previously hid
	showItAgain := imsjson.IncidentType{ID: *typeAID, Hidden: new(false)}
	_, resp = apis.editType(ctx, showItAgain)
	require.NoError(t, resp.Body.Close())
	// and see that it's no longer hidden
	typesResp, resp = apis.getTypes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeAID, Name: &typeA, Hidden: new(false)})
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeBID, Name: &typeB, Hidden: new(false)})
	require.Contains(t, typesResp, imsjson.IncidentType{ID: *typeCID, Name: &typeC, Hidden: new(false)})
}

// TestIncidentTypeGroup exercises the Phase 4a OCF category (group) field:
// set on create, change on update, clear with "", and reject invalid values.
func TestIncidentTypeGroup(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	apis := ApiHelper{t: t, serverURL: shared.serverURL, jwt: jwtForAdmin(ctx, t)}

	// Create a type with a group.
	name := rand.NonCryptoText()
	safety, operations, empty := "safety", "operations", ""
	id, resp := apis.editType(ctx, imsjson.IncidentType{Name: &name, Group: &safety})
	require.NoError(t, resp.Body.Close())
	require.NotNil(t, id)

	types, resp := apis.getTypes(ctx)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, types, imsjson.IncidentType{ID: *id, Name: &name, Hidden: new(false), Group: &safety})

	// Change the group.
	_, resp = apis.editType(ctx, imsjson.IncidentType{ID: *id, Group: &operations})
	require.NoError(t, resp.Body.Close())
	types, resp = apis.getTypes(ctx)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, types, imsjson.IncidentType{ID: *id, Name: &name, Hidden: new(false), Group: &operations})

	// An empty string clears the group (ungrouped).
	_, resp = apis.editType(ctx, imsjson.IncidentType{ID: *id, Group: &empty})
	require.NoError(t, resp.Body.Close())
	types, resp = apis.getTypes(ctx)
	require.NoError(t, resp.Body.Close())
	require.Contains(t, types, imsjson.IncidentType{ID: *id, Name: &name, Hidden: new(false)})

	// An unrecognized group is rejected with 400.
	badName, badGroup := rand.NonCryptoText(), "nonsense"
	_, resp = apis.editType(ctx, imsjson.IncidentType{Name: &badName, Group: &badGroup})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}
