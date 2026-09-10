// SPDX-License-Identifier: Apache-2.0

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
