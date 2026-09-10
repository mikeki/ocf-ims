// SPDX-License-Identifier: Apache-2.0

package testctr

import (
	"context"
	"log/slog"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	MariaDBVersion     = "10.5.27"
	MariaDBDockerImage = "mariadb:" + MariaDBVersion
)

// MariaDBContainer creates and runs a MariaDB TestContainer.
//
// If there is an error on startup, this function will terminate the TestContainer before returning.
// After calling this function, the caller must be sure to defer cleanup, e.g. by `t.Cleanup(cleanup)`.
func MariaDBContainer(ctx context.Context, database, username, password string) (
	ctr testcontainers.Container,
	cleanup func(),
	port int32,
	err error,
) {
	ctr, err = testcontainers.GenericContainer(
		ctx,
		testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        MariaDBDockerImage,
				ExposedPorts: []string{"3306/tcp"},
				WaitingFor:   wait.ForLog("port: 3306  mariadb.org binary distribution"),
				Env: map[string]string{
					"MARIADB_RANDOM_ROOT_PASSWORD": "true",
					"MARIADB_DATABASE":             database,
					"MARIADB_USER":                 username,
					"MARIADB_PASSWORD":             password,
				},
			},
			Started: true,
		},
	)
	cleanup = func() {
		if ctr != nil {
			err := ctr.Terminate(ctx)
			if err != nil {
				slog.Error("Failed to terminate container", "error", err)
			}
		}
	}
	if err != nil {
		cleanup()
		return nil, func() {}, 0, err
	}
	natPort, err := ctr.MappedPort(ctx, "3306/tcp")
	if err != nil {
		cleanup()
		return nil, func() {}, 0, err
	}
	dbHostPort := int32(natPort.Num())
	return ctr, cleanup, dbHostPort, nil
}
