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
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/go-sql-driver/mysql"
)

// maxTxAttempts bounds how many times RunInTx re-runs a transaction that fails
// with a transient, retryable error before giving up.
const maxTxAttempts = 4

// retryableTxErr reports whether err (anywhere in its wrapped chain) is a
// transient InnoDB transaction failure worth retrying: a deadlock (1213) or a
// lock-wait timeout (1205). InnoDB rolls the losing transaction back in both
// cases, so the documented remedy is simply to re-run the whole transaction.
// errors.As walks the chain, so this still matches when the driver error has
// been wrapped (e.g. inside an herr.HTTPError, whose Unwrap exposes it).
func retryableTxErr(err error) bool {
	var myErr *mysql.MySQLError
	if errors.As(err, &myErr) {
		return myErr.Number == 1213 || myErr.Number == 1205
	}
	return false
}

// RunInTx runs fn inside a database transaction: it begins the transaction,
// passes it to fn, then commits if fn returns nil or rolls back if fn returns a
// non-nil error. If an attempt fails with a transient deadlock / lock-wait
// timeout, RunInTx retries the WHOLE transaction (up to maxTxAttempts) after a
// short, growing backoff — that contention is momentary, so a retry almost
// always wins, which is what de-flakes the parallel attach/detach paths.
//
// Because a retry re-runs fn from a fresh transaction, fn must be safe to run
// more than once and must use the *sql.Tx it is handed for every query (not the
// surrounding DBQ, which would run outside the transaction). On the success
// path fn must return a literal nil, not a typed-nil error value.
func (dbq *DBQ) RunInTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	var err error
	for attempt := range maxTxAttempts {
		if attempt > 0 {
			// Brief, growing backoff so the contending transactions don't just
			// immediately collide again.
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 5 * time.Millisecond):
			}
		}

		var tx *sql.Tx
		tx, err = dbq.BeginTx(ctx, nil)
		if err != nil {
			return err
		}

		err = fn(tx)
		if err != nil {
			_ = tx.Rollback()
			if retryableTxErr(err) {
				continue
			}
			return err
		}

		err = tx.Commit()
		if err == nil {
			return nil
		}
		if !retryableTxErr(err) {
			return err
		}
		// A retryable error on commit: loop and re-run the whole transaction.
	}
	return err
}
