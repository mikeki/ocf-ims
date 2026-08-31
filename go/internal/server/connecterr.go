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

package server

import (
	"errors"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/lib/herr"
)

// ConnectErrorToHTTP maps a Connect error onto the REST tier's *herr.HTTPError so
// a REST handler can be reduced to a shim over a Connect-error-speaking domain
// function (plan 09h/1c, M13) without carrying a second implementation. The code
// mapping mirrors connect-go's own code→HTTP-status table for the statuses IMS
// actually returns; anything unmapped falls through to 500, the safe default.
//
// A nil error yields nil. The Connect message becomes the herr user message and
// the Connect error is kept as the wrapped cause for logging.
func ConnectErrorToHTTP(err error) *herr.HTTPError {
	if err == nil {
		return nil
	}
	msg := connect.CodeOf(err).String()
	var ce *connect.Error
	if errors.As(err, &ce) {
		msg = ce.Message()
	}
	switch connect.CodeOf(err) {
	case connect.CodeInvalidArgument:
		return herr.BadRequest(msg, err)
	case connect.CodeUnauthenticated:
		return herr.Unauthorized(msg, err)
	case connect.CodePermissionDenied:
		return herr.Forbidden(msg, err)
	case connect.CodeNotFound:
		return herr.NotFound(msg, err)
	case connect.CodeAlreadyExists, connect.CodeAborted:
		return herr.Conflict(msg, err)
	default:
		return herr.InternalServerError(msg, err)
	}
}
