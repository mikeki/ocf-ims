// SPDX-License-Identifier: Apache-2.0

package json

type Events []Event
type Event struct {
	ID          int32   `json:"id"`
	Name        *string `json:"name"`
	IsGroup     *bool   `json:"is_group"`
	ParentGroup *int32  `json:"parent_group"`
}
