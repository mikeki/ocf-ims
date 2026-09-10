// SPDX-License-Identifier: Apache-2.0

package web

import "embed"

// Are you hitting a compilation error here, because one of the
// files below cannot be found?
//
// Please run `go run bin/fetchbuilddeps/fetchbuilddeps.go`,
// as you need to have these files loaded in your filesystem in
// order to compile.

//go:embed static
//go:embed static/ext/bootstrap/bootstrap.min.css
//go:embed static/ext/bootstrap/bootstrap.bundle.min.js
//go:embed static/ext/jquery.min.js
//go:embed static/ext/datatables/dataTables.min.js
//go:embed static/ext/datatables/dataTables.bootstrap5.min.js
//go:embed static/ext/datatables/dataTables.bootstrap5.min.css
//go:embed static/ext/flatpickr/flatpickr.min.css
//go:embed static/ext/flatpickr/flatpickr.min.js
//go:embed static/ext/chartjs/chart.umd.min.js
var StaticFS embed.FS
