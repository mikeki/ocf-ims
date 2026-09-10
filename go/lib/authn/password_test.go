// SPDX-License-Identifier: Apache-2.0

package authn_test

import (
	"testing"

	"github.com/mikeki/ocf-ims/lib/authn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVerify_success(t *testing.T) {
	t.Parallel()
	hash := authn.NewSaltedArgon2idDevOnly("my password 123")

	isValid, err := authn.Verify("my password wrong", hash)
	require.NoError(t, err)
	assert.False(t, isValid)

	isValid, err = authn.Verify("my password 123", hash)
	require.NoError(t, err)
	assert.True(t, isValid)
}

func TestVerify_failure(t *testing.T) {
	t.Parallel()
	isValid, err := authn.Verify("some password", "this is not an argon2id hash")
	assert.False(t, isValid)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported non-argon2id stored password")
}

func BenchmarkHashArgon2id(b *testing.B) {
	for b.Loop() {
		authn.NewSaltedArgon2idDevOnly("my password 123")
	}
}
