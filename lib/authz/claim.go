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

package authz

import (
	"math"
	"math/big"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/mikeki/ocf-ims/lib/conv"
)

const compactIntBase = 62

// TokenType values for the "tok" claim. These distinguish access tokens from
// refresh tokens, so that one can never be used in place of the other.
const (
	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"
)

type IMSClaims struct {
	jwt.RegisteredClaims

	Handle         string `json:"han"`
	Positions      string `json:"pos"`
	Teams          string `json:"tea"`
	Admin          bool   `json:"adm,omitempty"`
	OnDutyPosition *int64 `json:"dut,omitempty"`
	TokenType      string `json:"tok,omitempty"`
}

func unmarshalBigInt(s string) *big.Int {
	if s == "" {
		return big.NewInt(0)
	}
	var z big.Int
	_, ok := z.SetString(s, compactIntBase)
	if !ok {
		return big.NewInt(0)
	}
	return &z
}

func bitSetToInts(bigint *big.Int) []int64 {
	if bigint.Cmp(big.NewInt(0)) == -1 {
		panic("got bigint less than zero")
	}
	var ints []int64
	for i := range bigint.BitLen() {
		if bigint.Bit(i) != 0 {
			ints = append(ints, int64(i))
		}
	}
	return ints
}

func intsToBitSet(ints []int64) *big.Int {
	bitset := big.NewInt(0)
	for _, t := range ints {
		bitset.SetBit(bitset, int(t), 1)
	}
	return bitset
}

func marshalBigInt(b *big.Int) string {
	return b.Text(compactIntBase)
}

func (c IMSClaims) WithExpiration(t time.Time) IMSClaims {
	c.ExpiresAt = jwt.NewNumericDate(t)
	return c
}

func (c IMSClaims) WithIssuedAt(t time.Time) IMSClaims {
	c.IssuedAt = jwt.NewNumericDate(t)
	return c
}

func (c IMSClaims) WithIssuer(s string) IMSClaims {
	c.Issuer = s
	return c
}

func (c IMSClaims) WithSubject(s string) IMSClaims {
	c.Subject = s
	return c
}

func (c IMSClaims) WithPersonHandle(s string) IMSClaims {
	c.Handle = s
	return c
}

func (c IMSClaims) WithPersonAdmin(admin bool) IMSClaims {
	c.Admin = admin
	return c
}

func (c IMSClaims) WithPersonPositions(pos ...int64) IMSClaims {
	c.Positions = marshalBigInt(intsToBitSet(pos))
	return c
}

func (c IMSClaims) WithPersonTeams(teams ...int64) IMSClaims {
	c.Teams = marshalBigInt(intsToBitSet(teams))
	return c
}

func (c IMSClaims) WithPersonOnDutyPosition(pos *int64) IMSClaims {
	c.OnDutyPosition = pos
	return c
}

func (c IMSClaims) WithTokenType(tokenType string) IMSClaims {
	c.TokenType = tokenType
	return c
}

func (c IMSClaims) PersonHandle() string {
	return c.Handle
}

func (c IMSClaims) PersonAdmin() bool {
	return c.Admin
}

func (c IMSClaims) PersonPositions() []int64 {
	return bitSetToInts(unmarshalBigInt(c.Positions))
}

func (c IMSClaims) PersonTeams() []int64 {
	return bitSetToInts(unmarshalBigInt(c.Teams))
}

// PersonID returns the authenticated person's local id (the JWT subject) as the
// int32 used by PERSON.ID and its foreign keys. It returns -1 if the subject is
// missing, unparseable, or out of int32 range; -1 fails safely against the FK
// rather than silently truncating a 64-bit value.
func (c IMSClaims) PersonID() int32 {
	sub, err := c.GetSubject()
	if err != nil {
		return -1
	}
	id, err := conv.ParseInt64(sub)
	if err != nil {
		return -1
	}
	if id < math.MinInt32 || id > math.MaxInt32 {
		return -1
	}
	return int32(id)
}

func (c IMSClaims) PersonOnDutyPosition() *int64 {
	return c.OnDutyPosition
}
