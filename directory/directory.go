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

package directory

import (
	"context"
	"errors"
	"fmt"
	"time"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/cache"
)

// UserStore is the consumer-facing seam over the user/personnel directory. It is
// satisfied by cachedUserStore (backed by the local IMS-DB people tables). API
// handlers depend on this interface rather than the concrete store so they can be
// unit-tested with an in-memory fake. See docs/plans/32-retire-clubhouse.md.
type UserStore interface {
	GetAllUsers(ctx context.Context) (map[int64]*User, error)
	GetPeople(ctx context.Context) ([]imsjson.Person, error)
	GetPositionsAndTeams(ctx context.Context) (positions, teams map[int64]string, err error)
	// InvalidateUsers drops the cached user data so the next read reflects writes
	// made directly to the underlying people tables (e.g. a password reset). Without
	// this, a changed password would not take effect until the cache TTL expired.
	InvalidateUsers()
}

// personSource is the pluggable data backend behind the caching UserStore
// implementation (cachedUserStore). Today the only implementation is
// localPersonSource (the local IMS-DB people tables), but the seam is kept so a
// future alternate source (e.g. an external directory or an importer) can plug in
// here and inherit the caching for free.
type personSource interface {
	users(ctx context.Context) (map[int64]*User, error)
	positions(ctx context.Context) (map[int64]string, error)
	teams(ctx context.Context) (map[int64]string, error)
}

type cachedUserStore struct {
	src           personSource
	userCache     *cache.InMemory[map[int64]*User]
	positionCache *cache.InMemory[map[int64]string]
	teamCache     *cache.InMemory[map[int64]string]
}

var _ UserStore = (*cachedUserStore)(nil)

type User struct {
	ID     int64
	Handle string
	Email  string
	// #nosec G117 // Exported secret struct field
	Password string
	// PasswordChanged is false while the person may still be on the shared default
	// password (IMS_DEFAULT_PASSWORD); it becomes true once they're known to be off
	// it. Lets GET /auth skip the argon2 verify for anyone already off the default.
	PasswordChanged    bool
	IsAdmin            bool
	PositionIDs        []int64
	PositionNames      []string
	TeamIDs            []int64
	TeamNames          []string
	OnDutyPositionID   *int64
	OnDutyPositionName *string
}

func newUserStore(src personSource, cacheTTL time.Duration) *cachedUserStore {
	us := &cachedUserStore{
		src: src,
	}
	us.userCache = cache.New(
		cacheTTL,
		us.refreshUserCache,
	)
	us.positionCache = cache.New(
		cacheTTL,
		us.refreshPositionCache,
	)
	us.teamCache = cache.New(
		cacheTTL,
		us.refreshTeamCache,
	)

	return us
}

func (store *cachedUserStore) GetAllUsers(ctx context.Context) (map[int64]*User, error) {
	users, err := store.userCache.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("[userCache.Get] %w", err)
	}
	return *users, nil
}

func (store *cachedUserStore) GetPeople(ctx context.Context) ([]imsjson.Person, error) {
	usersPtr, err := store.userCache.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("[userCache.Get] %w", err)
	}
	users := *usersPtr

	response := make([]imsjson.Person, 0, len(users))
	for _, r := range users {
		response = append(response, imsjson.Person{
			Handle:   r.Handle,
			Email:    r.Email,
			Password: r.Password,
			IsAdmin:  r.IsAdmin,
			PersonID: r.ID,
		})
	}

	return response, nil
}

func (store *cachedUserStore) GetPositionsAndTeams(ctx context.Context) (positions, teams map[int64]string, err error) {
	var errs []error
	posMap, err := store.positionCache.Get(ctx)
	errs = append(errs, err)
	teamMap, err := store.teamCache.Get(ctx)
	errs = append(errs, err)
	err = errors.Join(errs...)
	if err != nil {
		return nil, nil, fmt.Errorf("[GetPositionsAndTeams] %w", err)
	}
	return *posMap, *teamMap, nil
}

func (store *cachedUserStore) InvalidateUsers() {
	store.userCache.Invalidate()
}

func (store *cachedUserStore) refreshUserCache(ctx context.Context) (map[int64]*User, error) {
	return store.src.users(ctx)
}

func (store *cachedUserStore) refreshPositionCache(ctx context.Context) (map[int64]string, error) {
	return store.src.positions(ctx)
}

func (store *cachedUserStore) refreshTeamCache(ctx context.Context) (map[int64]string, error) {
	return store.src.teams(ctx)
}
