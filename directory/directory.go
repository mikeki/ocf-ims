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

// IUserStore is the consumer-facing seam over the user/personnel directory. It is
// satisfied today by the Clubhouse-backed UserStore and, as part of Phase 3, by a
// local IMS-DB-backed implementation. See docs/plans/31-local-people-directory.md.
type IUserStore interface {
	GetAllUsers(ctx context.Context) (map[int64]*User, error)
	GetRangers(ctx context.Context) ([]imsjson.Person, error)
	GetPositionsAndTeams(ctx context.Context) (positions, teams map[int64]string, err error)
}

// personSource is the pluggable data backend behind UserStore. It abstracts over
// the external Clubhouse directory (clubhouseSource) and the local IMS-DB people
// tables (localSource), so the caching layer and all API consumers stay identical
// regardless of where the people data lives.
type personSource interface {
	users(ctx context.Context) (map[int64]*User, error)
	positions(ctx context.Context) (map[int64]string, error)
	teams(ctx context.Context) (map[int64]string, error)
}

type UserStore struct {
	src           personSource
	userCache     *cache.InMemory[map[int64]*User]
	positionCache *cache.InMemory[map[int64]string]
	teamCache     *cache.InMemory[map[int64]string]
}

var _ IUserStore = (*UserStore)(nil)

type User struct {
	ID     int64
	Handle string
	Email  string
	Status string
	Onsite bool
	// #nosec G117 // Exported secret struct field
	Password           string
	PositionIDs        []int64
	PositionNames      []string
	TeamIDs            []int64
	TeamNames          []string
	OnDutyPositionID   *int64
	OnDutyPositionName *string
}

// NewUserStore builds a UserStore backed by the external Clubhouse directory.
func NewUserStore(dbq *DBQ, cacheTTL time.Duration) *UserStore {
	return newUserStore(&clubhouseSource{dbq: dbq}, cacheTTL)
}

func newUserStore(src personSource, cacheTTL time.Duration) *UserStore {
	us := &UserStore{
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

func (store *UserStore) GetAllUsers(ctx context.Context) (map[int64]*User, error) {
	users, err := store.userCache.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("[userCache.Get] %w", err)
	}
	return *users, nil
}

func (store *UserStore) GetRangers(ctx context.Context) ([]imsjson.Person, error) {
	usersPtr, err := store.userCache.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("[userCache.Get] %w", err)
	}
	users := *usersPtr

	response := make([]imsjson.Person, 0, len(users))
	for _, r := range users {
		response = append(response, imsjson.Person{
			Handle:      r.Handle,
			Email:       r.Email,
			Password:    r.Password,
			Status:      r.Status,
			Onsite:      r.Onsite,
			DirectoryID: r.ID,
		})
	}

	return response, nil
}

func (store *UserStore) GetPositionsAndTeams(ctx context.Context) (positions, teams map[int64]string, err error) {
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

func (store *UserStore) refreshUserCache(ctx context.Context) (map[int64]*User, error) {
	return store.src.users(ctx)
}

func (store *UserStore) refreshPositionCache(ctx context.Context) (map[int64]string, error) {
	return store.src.positions(ctx)
}

func (store *UserStore) refreshTeamCache(ctx context.Context) (map[int64]string, error) {
	return store.src.teams(ctx)
}

// clubhouseSource is the external-Clubhouse-directory backend for UserStore.
type clubhouseSource struct {
	dbq *DBQ
}

var _ personSource = (*clubhouseSource)(nil)

func (s *clubhouseSource) users(ctx context.Context) (map[int64]*User, error) {
	var errs []error
	persons, err := s.dbq.Persons(ctx, s.dbq)
	errs = append(errs, err)
	teamRows, err := s.dbq.Teams(ctx, s.dbq)
	errs = append(errs, err)
	positionRows, err := s.dbq.Positions(ctx, s.dbq)
	errs = append(errs, err)
	personTeams, err := s.dbq.PersonTeams(ctx, s.dbq)
	errs = append(errs, err)
	personPositions, err := s.dbq.PersonPositions(ctx, s.dbq)
	errs = append(errs, err)
	personsOnDuty, err := s.dbq.PersonsOnDuty(ctx, s.dbq)
	errs = append(errs, err)
	err = errors.Join(errs...)
	if err != nil {
		return nil, fmt.Errorf("[Teams,Positions,PersonTeams,PersonPositions] %w", err)
	}

	m := make(map[int64]*User, len(persons))
	for _, person := range persons {
		m[person.ID] = &User{
			ID:       person.ID,
			Handle:   person.Callsign,
			Email:    person.Email.String,
			Status:   string(person.Status),
			Onsite:   person.OnSite,
			Password: person.Password.String,
		}
	}
	positions := make(map[int64]string, len(positionRows))
	for _, positionRow := range positionRows {
		positions[positionRow.ID] = positionRow.Title
	}
	teams := make(map[int64]string, len(teamRows))
	for _, teamRow := range teamRows {
		teams[teamRow.ID] = teamRow.Title
	}
	for _, pp := range personPositions {
		if _, ok := m[pp.PersonID]; ok {
			person := m[pp.PersonID]
			person.PositionIDs = append(person.PositionIDs, pp.PositionID)
			person.PositionNames = append(person.PositionNames, positions[pp.PositionID])
		}
	}
	for _, pt := range personTeams {
		if _, ok := m[pt.PersonID]; ok {
			person := m[pt.PersonID]
			person.TeamIDs = append(person.TeamIDs, pt.TeamID)
			person.TeamNames = append(person.TeamNames, teams[pt.TeamID])
		}
	}
	for _, pod := range personsOnDuty {
		if _, ok := m[int64(pod.PersonID)]; ok {
			posID := int64(pod.PositionID)
			m[int64(pod.PersonID)].OnDutyPositionID = &posID
			if pos, ok := positions[int64(pod.PositionID)]; ok {
				m[int64(pod.PersonID)].OnDutyPositionName = &pos
			}
		}
	}
	return m, nil
}

func (s *clubhouseSource) positions(ctx context.Context) (map[int64]string, error) {
	positionRows, err := s.dbq.Positions(ctx, s.dbq)
	if err != nil {
		return nil, fmt.Errorf("[Positions]: %w", err)
	}
	positions := make(map[int64]string, len(positionRows))
	for _, row := range positionRows {
		positions[row.ID] = row.Title
	}
	return positions, nil
}

func (s *clubhouseSource) teams(ctx context.Context) (map[int64]string, error) {
	teamRows, err := s.dbq.Teams(ctx, s.dbq)
	if err != nil {
		return nil, fmt.Errorf("[Teams]: %w", err)
	}
	teams := make(map[int64]string, len(teamRows))
	for _, row := range teamRows {
		teams[row.ID] = row.Title
	}
	return teams, nil
}
