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

package incident

import (
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/attachment/fake"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContentDisposition(t *testing.T) {
	t.Parallel()
	// Safe-to-preview types render inline; anything downgraded to octet-stream
	// (unknown / HTML / SVG uploads) is forced to download (plan 90 L4).
	inline := []string{"image/png", "image/jpeg", "application/pdf", "text/plain", "video/mp4"}
	for _, ct := range inline {
		assert.Equal(t, "inline", ContentDisposition(ct), ct)
	}
	download := []string{octetStream, "application/zip", "image/svg+xml"}
	for _, ct := range download {
		assert.Equal(t, "attachment", ContentDisposition(ct), ct)
	}
}

func TestSaveAndRetrieveS3File(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	config := conf.AttachmentsStore{
		Type: "s3",
		S3:   conf.S3Attachments{},
	}
	filename := "myfile.txt"
	fileContents := []byte("hello world")

	// put the fake S3 client in place
	client, err := attachment.NewS3Client(ctx)
	require.NoError(t, err)
	client.S3Funcs = fake.NewS3Funcs()

	// make a test file, then upload it to the fake S3
	tempFilePath := filepath.Join(t.TempDir(), filename)
	err = os.WriteFile(tempFilePath, fileContents, 0600)
	require.NoError(t, err)
	file, err := os.Open(tempFilePath) // #nosec G304
	require.NoError(t, err)
	errHTTP := SaveFile(ctx,
		config,
		client,
		filename,
		file,
	)
	require.Nil(t, errHTTP)

	// now retrieve the file from the fake S3
	fileResp, httpError := RetrieveFile(ctx, config, client, filename)
	assert.Nil(t, httpError)
	all, err := io.ReadAll(fileResp)
	require.NoError(t, err)
	assert.Equal(t, fileContents, all)
}

func TestSaveAndRetrieveLocalFile(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	tempRoot, err := os.OpenRoot(t.TempDir())
	require.NoError(t, err)
	config := conf.AttachmentsStore{
		Type:  "local",
		Local: conf.LocalAttachments{Dir: tempRoot},
	}
	filename := "myfile.txt"
	fileContents := []byte("hello world")

	// make a test file, then save it via the attachments code
	tempFilePath := filepath.Join(t.TempDir(), filename)
	err = os.WriteFile(tempFilePath, fileContents, 0600)
	require.NoError(t, err)
	file, err := os.Open(tempFilePath) // #nosec G304
	require.NoError(t, err)
	errHTTP := SaveFile(ctx,
		config,
		nil,
		filename,
		file,
	)
	require.Nil(t, errHTTP)

	// now retrieve the file from the fake S3
	fileResp, httpError := RetrieveFile(ctx, config, nil, filename)
	assert.Nil(t, httpError)
	all, err := io.ReadAll(fileResp)
	require.NoError(t, err)
	assert.Equal(t, fileContents, all)
}

func TestDeleteLocalFile(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	tempRoot, err := os.OpenRoot(t.TempDir())
	require.NoError(t, err)
	config := conf.AttachmentsStore{
		Type:  "local",
		Local: conf.LocalAttachments{Dir: tempRoot},
	}
	filename := "myfile.txt"

	// Save a file, then delete it: it should no longer be retrievable.
	tempFilePath := filepath.Join(t.TempDir(), filename)
	require.NoError(t, os.WriteFile(tempFilePath, []byte("hello world"), 0600))
	file, err := os.Open(tempFilePath) // #nosec G304
	require.NoError(t, err)
	require.Nil(t, SaveFile(ctx, config, nil, filename, file))

	require.NoError(t, DeleteFile(ctx, config, nil, filename))

	_, httpError := RetrieveFile(ctx, config, nil, filename)
	require.Error(t, httpError)
	assert.Equal(t, http.StatusNotFound, httpError.Code)

	// Deleting a file that's already gone is a no-op (idempotent), and an empty name
	// is a no-op too — both matter because deletion is best-effort cleanup.
	require.NoError(t, DeleteFile(ctx, config, nil, filename))
	require.NoError(t, DeleteFile(ctx, config, nil, ""))
}

func TestDeleteS3File(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	config := conf.AttachmentsStore{
		Type: "s3",
		S3:   conf.S3Attachments{},
	}
	client, err := attachment.NewS3Client(ctx)
	require.NoError(t, err)
	client.S3Funcs = fake.NewS3Funcs()

	filename := "myfile.txt"
	tempFilePath := filepath.Join(t.TempDir(), filename)
	require.NoError(t, os.WriteFile(tempFilePath, []byte("hello world"), 0600))
	file, err := os.Open(tempFilePath) // #nosec G304
	require.NoError(t, err)
	require.Nil(t, SaveFile(ctx, config, client, filename, file))

	require.NoError(t, DeleteFile(ctx, config, client, filename))

	_, httpError := RetrieveFile(ctx, config, client, filename)
	require.Error(t, httpError)
	assert.Equal(t, http.StatusNotFound, httpError.Code)

	// Like real S3, deleting a missing key succeeds; empty name is a no-op.
	require.NoError(t, DeleteFile(ctx, config, client, filename))
	require.NoError(t, DeleteFile(ctx, config, client, ""))
}

func TestCheckAttachmentSize(t *testing.T) {
	t.Parallel()
	const maxBytes = 1000

	// At or under the cap is allowed; over the cap is rejected with 413.
	assert.Nil(t, checkAttachmentSize(&multipart.FileHeader{Size: maxBytes - 1}, maxBytes))
	assert.Nil(t, checkAttachmentSize(&multipart.FileHeader{Size: maxBytes}, maxBytes))
	errHTTP := checkAttachmentSize(&multipart.FileHeader{Size: maxBytes + 1}, maxBytes)
	require.Error(t, errHTTP)
	assert.Equal(t, http.StatusRequestEntityTooLarge, errHTTP.Code)
}

func TestSaveAndRetrieveLocalFile_Errors(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	tempRoot, err := os.OpenRoot(t.TempDir())
	require.NoError(t, err)
	config := conf.AttachmentsStore{
		Type:  "local",
		Local: conf.LocalAttachments{Dir: tempRoot},
	}

	// Try to retrieve a file that doesn't exist
	_, httpError := RetrieveFile(ctx, config, nil, "this-file-doesnt-exist")
	require.Error(t, httpError)
	assert.Equal(t, http.StatusNotFound, httpError.Code)

	// Request with empty filename
	_, httpError = RetrieveFile(ctx, config, nil, "")
	require.Error(t, httpError)
	assert.Equal(t, http.StatusNotFound, httpError.Code)

	// Try to retrieve a file from outside the local attachments root.
	// i.e. this call to TempDir() creates another temp directory, separate from the one
	// at the top of this test. os.Root won't let us escape from the preconfigured Root.
	_, httpError = RetrieveFile(ctx, config, nil, t.TempDir())
	require.Error(t, httpError)
	assert.Equal(t, http.StatusInternalServerError, httpError.Code)
}
