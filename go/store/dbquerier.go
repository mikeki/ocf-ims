// SPDX-License-Identifier: Apache-2.0

package store

import (
	"database/sql"

	"github.com/mikeki/ocf-ims/store/imsdb"
)

// DBQ combines the SQL database and the Querier for the IMS datastore.
type DBQ struct {
	*sql.DB
	imsdb.Querier
}

func NewDBQ(sqlDB *sql.DB, querier imsdb.Querier) *DBQ {
	return &DBQ{
		DB:      sqlDB,
		Querier: querier,
	}
}
