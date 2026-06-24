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

package store

import (
	"errors"
	"fmt"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
)

func TestRetryableTxErr(t *testing.T) {
	t.Parallel()

	deadlock := &mysql.MySQLError{Number: 1213, Message: "Deadlock found"}
	lockWait := &mysql.MySQLError{Number: 1205, Message: "Lock wait timeout exceeded"}
	dup := &mysql.MySQLError{Number: 1062, Message: "Duplicate entry"}

	assert.True(t, retryableTxErr(deadlock), "deadlock (1213) is retryable")
	assert.True(t, retryableTxErr(lockWait), "lock-wait timeout (1205) is retryable")
	assert.False(t, retryableTxErr(dup), "duplicate entry (1062) is not retryable")
	assert.False(t, retryableTxErr(errors.New("some other error")), "a non-driver error is not retryable")
	assert.False(t, retryableTxErr(nil), "nil is not retryable")

	// A retryable driver error stays detectable when wrapped (e.g. the way a
	// handler wraps it in an herr.HTTPError, whose Unwrap exposes the chain).
	wrapped := fmt.Errorf("attach failed: %w", fmt.Errorf("detach: %w", deadlock))
	assert.True(t, retryableTxErr(wrapped), "a wrapped deadlock is still retryable")
}
