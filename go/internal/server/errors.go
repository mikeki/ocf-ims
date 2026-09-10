// SPDX-License-Identifier: Apache-2.0

package server

import (
	"errors"

	"connectrpc.com/connect"
)

// publicError is the error value behind PublicError / InternalError: it carries the
// client-facing message and, separately, the server-side cause. connect-go puts
// err.Error() on the wire, so Error() returns ONLY the public message; the cause is
// reachable through errors.Unwrap (so errors.Is/As still see through it, and the slog
// interceptor can log it) but never crosses the boundary.
//
// This is the Connect-tier analogue of herr.HTTPError's ResponseMessage/InternalErr
// split, which the REST tier relied on to keep MariaDB error text (table and column
// names, constraint names) out of the browser while still logging it server-side.
type publicError struct {
	public string
	cause  error
}

func (e *publicError) Error() string { return e.public }
func (e *publicError) Unwrap() error { return e.cause }

// PublicError builds a Connect error whose wire message is public and whose cause stays
// server-side (see publicError). cause may be nil.
func PublicError(code connect.Code, public string, cause error) *connect.Error {
	return connect.NewError(code, &publicError{public: public, cause: cause})
}

// InternalError is PublicError for CodeInternal — the error a domain method returns when
// something server-side failed (a store call, a library). The client sees only public
// (a short "what failed", the same text the REST tier used as its ResponseMessage);
// cause — the wrapped store/library error — is what the slog interceptor logs. It
// replaces the `connect.NewError(connect.CodeInternal, fmt.Errorf("...: %w", err))`
// idiom, which sent err.Error(), i.e. the raw cause, to the client.
func InternalError(public string, cause error) *connect.Error {
	return PublicError(connect.CodeInternal, public, cause)
}

// ErrorCause returns the server-side cause behind an error built by PublicError /
// InternalError / HerrToConnect (anywhere in err's Unwrap chain), or nil if there is
// none — a plain connect.NewError(code, errors.New(msg)) has no hidden cause.
func ErrorCause(err error) error {
	var pe *publicError
	if errors.As(err, &pe) {
		return pe.cause
	}
	return nil
}
