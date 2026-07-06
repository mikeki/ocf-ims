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

package api

import (
	"context"
	"slices"
	"testing"

	"github.com/mikeki/ocf-ims/directory"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeUserStore is a directory.UserStore whose people come from an in-memory
// map, so resolveTypedMentionIDs can be exercised without a database.
type fakeUserStore struct {
	users map[int64]*directory.User
}

func newFakeUserStore(handlesByID map[int64]string) *fakeUserStore {
	users := make(map[int64]*directory.User, len(handlesByID))
	for id, handle := range handlesByID {
		users[id] = &directory.User{ID: id, Handle: handle}
	}
	return &fakeUserStore{users: users}
}

func (f *fakeUserStore) GetAllUsers(context.Context) (map[int64]*directory.User, error) {
	return f.users, nil
}
func (f *fakeUserStore) GetPeople(context.Context) ([]imsjson.Person, error) { return nil, nil }
func (f *fakeUserStore) GetPositions(context.Context) (map[int64]string, error) {
	return map[int64]string{}, nil
}
func (f *fakeUserStore) InvalidateUsers() {}

func TestResolveTypedMentionIDs(t *testing.T) {
	t.Parallel()

	store := newFakeUserStore(map[int64]string{
		1: "Hardware",
		2: "Bob",
		3: "k9",
	})

	cases := []struct {
		name string
		text string
		want []int32
	}{
		{name: "no at-sign", text: "nothing to see here", want: nil},
		{name: "plain handle", text: "paging @Hardware to gate 5", want: []int32{1}},
		{name: "case-insensitive", text: "@hardware please respond", want: []int32{1}},
		{name: "at start of text", text: "@Bob heads up", want: []int32{2}},
		{name: "trailing punctuation", text: "thanks @Bob, and @Hardware.", want: []int32{2, 1}},
		{name: "digits in handle", text: "send @k9 over", want: []int32{3}},
		{name: "unknown handle ignored", text: "@nobody around", want: nil},
		{name: "mid-word at is not a mention", text: "email bob@example.com", want: nil},
		{name: "multiple mentions", text: "@Bob and @Hardware", want: []int32{2, 1}},
		{name: "repeated handle resolves each time", text: "@Bob @Bob", want: []int32{2, 2}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := resolveTypedMentionIDs(context.Background(), store, tc.text)
			require.NoError(t, err)
			// Order isn't part of the contract (the insert is insert-ignore and the
			// notify step dedups), so compare as multisets.
			gotSorted := append([]int32(nil), got...)
			wantSorted := append([]int32(nil), tc.want...)
			slices.Sort(gotSorted)
			slices.Sort(wantSorted)
			assert.Equal(t, wantSorted, gotSorted)
		})
	}
}
