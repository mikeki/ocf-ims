// SPDX-License-Identifier: Apache-2.0

package json

import "time"

type ActionLogs []ActionLog

type ActionLog struct {
	ID            int64     `json:"id"`
	CreatedAt     time.Time `json:"created_at"`
	ActionType    string    `json:"action_type"`
	Method        string    `json:"method,omitzero"`
	Path          string    `json:"path,omitzero"`
	Referrer      string    `json:"referrer,omitzero"`
	UserID        int64     `json:"user_id,omitzero"`
	UserName      string    `json:"user_name"`
	PositionID    int64     `json:"position_id,omitzero"`
	PositionName  string    `json:"position_name"`
	ClientAddress string    `json:"client_address,omitzero"`
	HttpStatus    int16     `json:"http_status,omitzero"`
	Duration      string    `json:"duration,omitzero"`
}
