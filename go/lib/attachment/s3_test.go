// SPDX-License-Identifier: Apache-2.0

package attachment_test

import (
	"bytes"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/attachment/fake"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"testing"
)

func TestS3ClientGetObject(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	client, err := attachment.NewS3Client(t.Context())
	require.NoError(t, err)
	require.NotNil(t, client)
	client.S3Funcs = fake.NewS3Funcs()

	file := []byte("hello world")
	errHTTP := client.UploadToS3(ctx, "some-bucket", "myobject", bytes.NewReader(file))
	require.Nil(t, errHTTP)
	reader, errHTTP := client.GetObject(ctx, "some-bucket", "myobject")
	require.Nil(t, errHTTP)
	retrieved, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.Equal(t, file, retrieved)

	// doesn't exist
	_, errHTTP = client.GetObject(ctx, "some-bucket", "not a key!")
	require.NotNil(t, errHTTP)
	require.Equal(t, http.StatusNotFound, errHTTP.Code)
}
