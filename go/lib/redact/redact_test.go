// SPDX-License-Identifier: Apache-2.0

package redact_test

import (
	"fmt"
	"github.com/mikeki/ocf-ims/lib/redact"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"os"
	"strings"
	"testing"
)

type ExampleType struct {
	SomeString  string
	SomeNum     int
	Passwords   []string `redact:"true"`
	Secret      Secret   `redact:"true"`
	Secrets     []Secret `redact:"true"`
	MoreSecrets []Secret `redact:"true"`
	Dir1        *os.Root
	Dir2        *os.Root
	SomeStruct  struct{}
}

type Secret struct {
	Things []string
	PIN    int
}

func TestToBytes(t *testing.T) {
	t.Parallel()
	root, err := os.OpenRoot(t.TempDir())
	require.NoError(t, err)
	e := ExampleType{
		SomeString: "This is a string",
		SomeNum:    123456,
		Passwords: []string{
			"password1",
			"password2",
			"password3",
		},
		Secret: Secret{
			Things: []string{"abc"},
			PIN:    123,
		},
		Secrets: []Secret{{}, {}},
		Dir2:    root,
	}
	expected := fmt.Sprintf(`
SomeString = This is a string
SomeNum = 123456
Passwords = [🤐🤐🤐🤐]
Secret
    🤐🤐🤐🤐🤐
Secrets[0]
    🤐🤐
Secrets[1]
    🤐🤐
MoreSecrets[]: [empty]
Dir1 = <nil>
Dir2 = %v
SomeStruct is zero value
`, root.Name())
	b := redact.ToBytes(&e)
	assert.Equal(t, strings.TrimSpace(expected), strings.TrimSpace(string(b)))
}

type ExampleType2 struct {
	SSN   string `redact:"true"`
	MyMap map[string]string
}

func TestToBytes_noMapSupport(t *testing.T) {
	t.Parallel()
	// we haven't bothered adding support for various Kinds yet, but feel free to do so if the need arises!
	e := ExampleType2{
		SSN:   "someKey",
		MyMap: map[string]string{"dog": "pony"},
	}
	expected := `
SSN = 🤐🤐🤐
MyMap [Unsupported field kind (map)]
`
	b := redact.ToBytes(&e)
	assert.Equal(t, strings.TrimSpace(expected), strings.TrimSpace(string(b)))
}
