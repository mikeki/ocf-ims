// SPDX-License-Identifier: Apache-2.0

package authz

import (
	"errors"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
)

type JWTer struct {
	SecretKey string
}

func (j JWTer) createJWT(claims IMSClaims) (string, error) {
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString([]byte(j.SecretKey))
	if err != nil {
		return "", fmt.Errorf("[SignedString]: %w", err)
	}
	return token, nil
}

func (j JWTer) authenticateJWT(jwtStr, wantTokenType string) (*IMSClaims, error) {
	if jwtStr == "" {
		return nil, errors.New("no JWT string provided")
	}
	claims := IMSClaims{}
	tok, err := jwt.ParseWithClaims(jwtStr, &claims, func(token *jwt.Token) (any, error) {
		return []byte(j.SecretKey), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Name}))
	if err != nil {
		return nil, fmt.Errorf("[jwt.Parse]: %w", err)
	}
	if tok == nil {
		return nil, errors.New("token is nil")
	}
	if !tok.Valid {
		return nil, errors.New("token is invalid")
	}
	if claims.PersonHandle() == "" {
		return nil, errors.New("person handle is required")
	}
	// Access and refresh tokens are both JWTs signed by the same key, so this
	// check is what stops a refresh token from being used as a bearer access
	// token (or an access token from being used to mint new access tokens).
	if claims.TokenType != wantTokenType {
		return nil, fmt.Errorf("token type %q is not valid here", claims.TokenType)
	}
	return &claims, nil
}
