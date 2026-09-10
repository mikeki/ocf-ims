// SPDX-License-Identifier: Apache-2.0

package authz

import (
	"strconv"
	"time"
)

// SuggestedEarlyAccessTokenRefresh is how long before an access token actually expires that web
// clients should consider refreshing the token. This prevents annoying client-side errors,
// when the client thinks its access token is still valid, makes a request, but by the time the server
// is actually getting around to processing the request, the access token is already expired.
const SuggestedEarlyAccessTokenRefresh time.Duration = -10 * time.Second

func (j JWTer) CreateAccessToken(
	personHandle string,
	personID int64,
	positionIDs []int64,
	isAdmin bool,
	onDutyPositionID *int64,
	expiration time.Time,
) (string, error) {
	return j.createJWT(
		IMSClaims{}.
			WithIssuedAt(time.Now()).
			WithExpiration(expiration).
			WithIssuer("ims").
			WithTokenType(TokenTypeAccess).
			WithPersonHandle(personHandle).
			WithPersonAdmin(isAdmin).
			WithPersonOnDutyPosition(onDutyPositionID).
			WithPersonPositions(positionIDs...).
			WithSubject(strconv.FormatInt(personID, 10)),
	)
}

// AuthenticateJWT gives JWT claims for a valid, authenticated access token, or
// returns an error otherwise. A JWT may be invalid because it was signed by a
// different key, because it has expired, because it isn't an access token, etc.
func (j JWTer) AuthenticateJWT(jwtStr string) (*IMSClaims, error) {
	return j.authenticateJWT(jwtStr, TokenTypeAccess)
}
