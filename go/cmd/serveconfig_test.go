// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"
	"time"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/stretchr/testify/assert"
)

// TestMustApplyEnvConfig should be the only test in the whole repo that
// freely plays with setting environment variables, since parallel testing
// means other tests will notice the result of "Setenvs" that occur at the
// same time.
//
// All other tests should use a conf.IMSConfig struct instead, as that
// is unaffected by environment variables changing later.
func TestMustApplyEnvConfig(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("IMS_HOSTNAME", "host")
	t.Setenv("IMS_PORT", "1234")
	t.Setenv("IMS_PASSWORD", "password")
	t.Setenv("IMS_DEPLOYMENT", "dev")
	t.Setenv("IMS_TOKEN_LIFETIME", "1000")
	t.Setenv("IMS_ACCESS_TOKEN_LIFETIME", "100")
	t.Setenv("IMS_MAX_ATTACHMENT_SIZE", "7")
	t.Setenv("IMS_CACHE_CONTROL_SHORT", "3m")
	t.Setenv("IMS_CACHE_CONTROL_LONG", "7m")
	t.Setenv("IMS_DIRECTORY_CACHE_TTL", "15m")
	t.Setenv("IMS_LOG_LEVEL", "WARN")
	t.Setenv("IMS_ACTION_LOG_ENABLED", "true")
	t.Setenv("IMS_JWT_SECRET", "shhh")
	t.Setenv("IMS_DB_HOST_NAME", "db")
	t.Setenv("IMS_DB_STORE_TYPE", "mariadb")
	t.Setenv("IMS_DB_HOST_PORT", "555")
	t.Setenv("IMS_DB_DATABASE", "ims")
	t.Setenv("IMS_DB_USER_NAME", "me")
	t.Setenv("IMS_DB_PASSWORD", "boo")
	t.Setenv("IMS_ATTACHMENTS_STORE", "local")
	t.Setenv("IMS_ATTACHMENTS_LOCAL_DIR", tempDir)
	t.Setenv("AWS_ACCESS_KEY_ID", "my name")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "my key")
	t.Setenv("AWS_REGION", "mars")
	t.Setenv("IMS_ATTACHMENTS_S3_BUCKET", "big-bucket")
	t.Setenv("IMS_ATTACHMENTS_S3_COMMON_KEY_PREFIX", "safe/dir")
	t.Setenv("IMS_CORS_ALLOWED_ORIGINS", " http://localhost:8081, http://192.168.1.10:8081 ,, ")

	baseCfg := conf.DefaultIMS()
	cfg := mustApplyEnvConfig(baseCfg, ".env")

	assert.Equal(t, "host", cfg.Core.Host)
	assert.Equal(t, int32(1234), cfg.Core.Port)
	assert.Equal(t, conf.DeploymentTypeDev, cfg.Core.Deployment)
	assert.Equal(t, 1000*time.Second, cfg.Core.RefreshTokenLifetime)
	assert.Equal(t, 100*time.Second, cfg.Core.AccessTokenLifetime)
	// IMS_MAX_ATTACHMENT_SIZE is given in MiB (7 -> 7 MiB in bytes).
	assert.Equal(t, int64(7<<20), cfg.Core.MaxAttachmentBytes)
	assert.Equal(t, 3*time.Minute, cfg.Core.CacheControlShort)
	assert.Equal(t, 7*time.Minute, cfg.Core.CacheControlLong)
	assert.Equal(t, 15*time.Minute, cfg.Directory.InMemoryCacheTTL)
	assert.Equal(t, "WARN", cfg.Core.LogLevel)
	assert.True(t, cfg.Core.ActionLogEnabled)
	assert.Equal(t, "shhh", cfg.Core.JWTSecret)
	assert.Equal(t, conf.DBStoreTypeMaria, cfg.Store.Type)
	assert.Equal(t, "db", cfg.Store.MariaDB.HostName)
	assert.Equal(t, int32(555), cfg.Store.MariaDB.HostPort)
	assert.Equal(t, "ims", cfg.Store.MariaDB.Database)
	assert.Equal(t, "me", cfg.Store.MariaDB.Username)
	assert.Equal(t, "boo", cfg.Store.MariaDB.Password)
	assert.Equal(t, conf.AttachmentsStoreLocal, cfg.AttachmentsStore.Type)
	assert.Equal(t, tempDir, cfg.AttachmentsStore.Local.Dir.Name())
	assert.Equal(t, "my name", cfg.AttachmentsStore.S3.AWSAccessKeyID)
	assert.Equal(t, "my key", cfg.AttachmentsStore.S3.AWSSecretAccessKey)
	assert.Equal(t, "mars", cfg.AttachmentsStore.S3.AWSRegion)
	assert.Equal(t, "big-bucket", cfg.AttachmentsStore.S3.Bucket)
	assert.Equal(t, "safe/dir", cfg.AttachmentsStore.S3.CommonKeyPrefix)
	// Comma-separated, whitespace-tolerant, empties dropped (plan 09j).
	assert.Equal(t, []string{"http://localhost:8081", "http://192.168.1.10:8081"}, cfg.Core.CORSAllowedOrigins)
}

// TestSplitCommaList pins the env-list parsing IMS_CORS_ALLOWED_ORIGINS relies on: an empty
// or blank value is nil (so the compose passthrough's "" default leaves CORS off), and
// surrounding whitespace / empty entries are dropped.
func TestSplitCommaList(t *testing.T) {
	t.Parallel()
	assert.Nil(t, splitCommaList(""))
	assert.Nil(t, splitCommaList("  , ,"))
	assert.Equal(t, []string{"a"}, splitCommaList("a"))
	assert.Equal(t, []string{"a", "b"}, splitCommaList(" a ,b,, "))
}
