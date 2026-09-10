// SPDX-License-Identifier: Apache-2.0

package conf_test

import (
	"github.com/mikeki/ocf-ims/conf"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"os"
	"strings"
	"testing"
)

func TestPrintRedacted(t *testing.T) {
	t.Parallel()
	cfg := conf.IMSConfig{
		Core: conf.ConfigCore{},
		Store: conf.DBStore{
			Type: conf.DBStoreTypeMaria,
			MariaDB: conf.DBStoreMaria{
				Username: "db username",
				Password: "db password",
			},
		},
	}

	redacted := cfg.PrintRedacted()
	assert.Contains(t, redacted, "db username")
	assert.NotContains(t, redacted, "db password")
	assert.NotContains(t, redacted, "user password")
}

func TestValidateBase(t *testing.T) {
	t.Parallel()

	cfg := conf.DefaultIMS()
	require.NoError(t, cfg.Validate())

	// must have AccessTokenLifetime <= RefreshTokenLifetime
	cfg.Core.AccessTokenLifetime = cfg.Core.RefreshTokenLifetime + 1
	require.Error(t, cfg.Validate())

	// MaxAttachmentBytes must be positive and must not exceed the request-size cap.
	cfg = conf.DefaultIMS()
	cfg.Core.MaxAttachmentBytes = 0
	require.Error(t, cfg.Validate())

	cfg = conf.DefaultIMS()
	cfg.Core.MaxAttachmentBytes = cfg.Core.MaxRequestBytes + 1
	require.Error(t, cfg.Validate())
}

func TestValidateDBStore(t *testing.T) {
	t.Parallel()

	cfg := conf.DefaultIMS()
	cfg.Store.Type = "invalid type"
	require.Error(t, cfg.Validate())
}

func TestValidateDefaultPassword(t *testing.T) {
	t.Parallel()

	// Empty (the default) is fine — the feature is opt-in.
	cfg := conf.DefaultIMS()
	require.NoError(t, cfg.Validate())

	// A too-short default is rejected at boot.
	cfg = conf.DefaultIMS()
	cfg.Core.DefaultPassword = "short"
	require.Error(t, cfg.Validate())

	// A reasonable-length default validates.
	cfg = conf.DefaultIMS()
	cfg.Core.DefaultPassword = "changeme123!"
	require.NoError(t, cfg.Validate())
}

func TestValidateNonDevDeployment(t *testing.T) {
	t.Parallel()

	cfg := conf.DefaultIMS()
	cfg.Core.Deployment = "not a valid deployment"
	require.Error(t, cfg.Validate())

	// non-dev deployment requires MariaDB store (give it a valid-length secret so
	// this asserts the store-type failure, not the JWT-secret rule below).
	cfg = conf.DefaultIMS()
	cfg.Core.Deployment = conf.DeploymentTypeProduction
	cfg.Core.JWTSecret = strings.Repeat("a", 32)
	cfg.Store.Type = conf.DBStoreTypeNoOp
	require.Error(t, cfg.Validate())
}

func TestValidateJWTSecretLength(t *testing.T) {
	t.Parallel()

	// Dev is exempt: the short random per-boot default is fine.
	cfg := conf.DefaultIMS()
	require.NoError(t, cfg.Validate())
	require.Less(t, len(cfg.Core.JWTSecret), 32, "dev default is expected to be short")

	// A non-dev deployment with a short secret is rejected.
	cfg = conf.DefaultIMS()
	cfg.Core.Deployment = conf.DeploymentTypeProduction
	cfg.Core.JWTSecret = "too-short"
	require.Error(t, cfg.Validate())

	// A non-dev deployment with a >=32-character secret is accepted.
	cfg = conf.DefaultIMS()
	cfg.Core.Deployment = conf.DeploymentTypeProduction
	cfg.Core.JWTSecret = strings.Repeat("a", 32)
	require.NoError(t, cfg.Validate())
}

// TestValidateCORSAllowedOrigins pins the allow-list's "exact origin" rule (plan 09j): rs/cors
// matches the Origin header verbatim, so anything that is not scheme://host[:port] would never
// match and fail silently in the browser — reject it at boot instead.
func TestValidateCORSAllowedOrigins(t *testing.T) {
	t.Parallel()

	cfg := conf.DefaultIMS()
	require.Empty(t, cfg.Core.CORSAllowedOrigins, "CORS is off by default")
	cfg.Core.CORSAllowedOrigins = []string{"http://localhost:8081", "https://ims-dev.example.org", "http://192.168.1.10:8081"}
	require.NoError(t, cfg.Validate())

	for _, bad := range []string{
		"*",                      // wildcard: browsers refuse it alongside credentials
		"http://*.example.org",   // wildcard host
		"localhost:8081",         // no scheme (parses as scheme "localhost")
		"http://localhost:8081/", // trailing slash never matches an Origin header
		"http://localhost/ims",   // path
		"http://localhost?x=1",   // query
		"http://localhost#frag",  // fragment
		"ftp://localhost",        // not a web origin
		"http://user@localhost",  // userinfo
		"",                       // empty entry (the env parser drops these; a literal one is a bug)
		"http://",                // no host
	} {
		cfg = conf.DefaultIMS()
		cfg.Core.CORSAllowedOrigins = []string{bad}
		err := cfg.Validate()
		require.Error(t, err, "origin %q should be rejected", bad)
		require.Contains(t, err.Error(), "IMS_CORS_ALLOWED_ORIGINS")
	}
}

func TestValidateAttachmentsStore(t *testing.T) {
	t.Parallel()
	temp, err := os.OpenRoot(t.TempDir())
	require.NoError(t, err)

	cfg := conf.DefaultIMS()
	cfg.AttachmentsStore.Type = conf.AttachmentsStoreS3
	// this will ultimately be ignored
	cfg.AttachmentsStore.Local.Dir = temp
	cfg.AttachmentsStore.S3 = conf.S3Attachments{
		AWSAccessKeyID:     "abc",
		AWSSecretAccessKey: "def",
		AWSRegion:          "there",
		Bucket:             "buck",
		CommonKeyPrefix:    "a/b",
	}
	require.NoError(t, cfg.Validate())

	//// This field is required for an S3 attachments store
	// cfg.AttachmentsStore.S3.AWSSecretAccessKey = ""
	// require.Error(t, cfg.Validate())

	// local attachments store requires a local dir to be set
	cfg = conf.DefaultIMS()
	cfg.AttachmentsStore.Type = conf.AttachmentsStoreLocal
	require.Error(t, cfg.Validate())

	cfg = conf.DefaultIMS()
	cfg.AttachmentsStore.Type = "invalid type"
	require.Error(t, cfg.Validate())
}

func TestValidatePush(t *testing.T) {
	t.Parallel()

	// Default (no VAPID config) is valid and reports push disabled.
	cfg := conf.DefaultIMS()
	require.NoError(t, cfg.Validate())
	assert.False(t, cfg.Push.Enabled())

	// A complete key pair + subject is valid and enables push.
	cfg = conf.DefaultIMS()
	cfg.Push = conf.Push{
		VAPIDPublicKey:  "pub",
		VAPIDPrivateKey: "priv",
		VAPIDSubject:    "mailto:ims@example.org",
	}
	require.NoError(t, cfg.Validate())
	assert.True(t, cfg.Push.Enabled())

	// A half-configured key pair is rejected at boot.
	cfg = conf.DefaultIMS()
	cfg.Push = conf.Push{VAPIDPublicKey: "pub"}
	require.Error(t, cfg.Validate())

	cfg = conf.DefaultIMS()
	cfg.Push = conf.Push{VAPIDPublicKey: "pub", VAPIDPrivateKey: "priv"}
	require.Error(t, cfg.Validate(), "missing subject should fail")

	// The private key is redacted in printed config.
	cfg = conf.DefaultIMS()
	cfg.Push = conf.Push{
		VAPIDPublicKey:  "pub-not-secret",
		VAPIDPrivateKey: "priv-is-secret",
		VAPIDSubject:    "mailto:ims@example.org",
	}
	redacted := cfg.PrintRedacted()
	assert.Contains(t, redacted, "pub-not-secret")
	assert.NotContains(t, redacted, "priv-is-secret")
}
