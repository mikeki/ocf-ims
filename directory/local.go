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
	"fmt"
	"time"

	"github.com/mikeki/ocf-ims/store"
)

// NewLocalUserStore builds a UserStore backed by the local IMS-DB people tables
// (PERSON/POSITION and their membership table) instead of the external Clubhouse
// directory. See docs/plans/31-local-people-directory.md.
func NewLocalUserStore(imsDBQ *store.DBQ, cacheTTL time.Duration) UserStore {
	return newUserStore(&localPersonSource{dbq: imsDBQ}, cacheTTL)
}

// localPersonSource is the local-IMS-DB backend for the cached UserStore.
type localPersonSource struct {
	dbq *store.DBQ
}

var _ personSource = (*localPersonSource)(nil)

func (s *localPersonSource) users(ctx context.Context) (map[int64]*User, error) {
	people, err := s.dbq.People(ctx, s.dbq)
	if err != nil {
		return nil, fmt.Errorf("[People]: %w", err)
	}
	positions, err := s.positions(ctx)
	if err != nil {
		return nil, err
	}
	personPositions, err := s.dbq.PeoplePositions(ctx, s.dbq)
	if err != nil {
		return nil, fmt.Errorf("[PeoplePositions]: %w", err)
	}

	m := make(map[int64]*User, len(people))
	for _, person := range people {
		m[int64(person.ID)] = &User{
			ID:              int64(person.ID),
			Handle:          person.Handle.String,
			Email:           person.Email.String,
			Password:        person.Password.String,
			PasswordChanged: person.PasswordChanged,
			IsAdmin:         person.IsAdmin,
		}
	}
	for _, pp := range personPositions {
		if person, ok := m[int64(pp.PersonID)]; ok {
			person.PositionIDs = append(person.PositionIDs, int64(pp.PositionID))
			person.PositionNames = append(person.PositionNames, positions[int64(pp.PositionID)])
		}
	}
	// On-duty has no local equivalent yet (no timesheet table), so onduty: access
	// expressions are inert until a later Phase 3 slice. See the design doc.
	return m, nil
}

func (s *localPersonSource) positions(ctx context.Context) (map[int64]string, error) {
	rows, err := s.dbq.PeoplePositionsList(ctx, s.dbq)
	if err != nil {
		return nil, fmt.Errorf("[PeoplePositionsList]: %w", err)
	}
	positions := make(map[int64]string, len(rows))
	for _, row := range rows {
		positions[int64(row.ID)] = row.Name
	}
	return positions, nil
}
