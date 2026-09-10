// SPDX-License-Identifier: Apache-2.0

package template

// shortRef returns the first 8 characters of a git revision (or the whole string
// if it's shorter), for a compact commit-SHA display in the footer.
func shortRef(ref string) string {
	const shortLen = 8
	if len(ref) > shortLen {
		return ref[:shortLen]
	}
	return ref
}
