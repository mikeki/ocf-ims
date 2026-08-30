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

package main

import (
	"bufio"
	"bytes"
	"context"
	"flag"
	"fmt"
	"golang.org/x/sync/errgroup"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var outputApp = flag.String("output-app", "ocf-ims", "Output app name")
var generateOnly = flag.Bool("generate-only", false, "Run the code generators only; skip the final `go build`")

func main() {
	flag.Parse()
	start := time.Now()
	ctx := context.Background()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	// Diverging roots (plan 09f): after the go/ relocation the Go module root
	// (holds go.mod) and the repo root (holds proto/ + the buf configs, shared
	// with the TS tier) are different directories. Most generators run from the
	// MODULE root; buf runs from the module root too — that is where `go tool`
	// resolves the pinned buf — but is pointed UP at the repo root's proto/ and
	// templates; pnpm runs from the REPO root, where the workspace lives.
	modRoot := moduleRoot(ctx)
	repoRoot := repoRootFrom(modRoot)
	mod, err := os.OpenRoot(modRoot)
	must(err)

	eg, gCtx := errgroup.WithContext(ctx)
	eg.Go(func() error {
		mustRunInDir(exec.CommandContext(gCtx, "go", "tool", "sqlc", "generate"), mod.Name())
		return nil
	})
	eg.Go(func() error {
		mustRunInDir(exec.CommandContext(gCtx, "go", "tool", "templ", "generate"), mod.Name())
		return nil
	})
	eg.Go(func() error {
		mustRunInDir(exec.CommandContext(gCtx, "go", "tool", "tsgo"), mod.Name())
		// We presume that all of these JS files were generated from TypeScript, as
		// that's currently the case. `tsc` had a `--listEmittedFiles` flag that would
		// aid here, but `tsgo` doesn't yet have that feature.
		jsFiles, err := fs.Glob(mod.FS(), filepath.Join("web", "static", "*.js"))
		must(err)
		for _, match := range jsFiles {
			addTSGeneratedHeader(mod, match)
		}
		return nil
	})
	eg.Go(func() error {
		// Proto codegen (see docs/plans/09-proto-connect-platform.md). The
		// hermetic Go-tool targets in buf.gen.yaml (protoc-gen-go,
		// protoc-gen-connect-go, protoc-gen-connect-openapi) always run — they
		// need no JS toolchain, so this also works in the `golang:alpine` Docker
		// build stage. The `proto` input generates only the first-party module;
		// the vendored third_party/protovalidate is import-only (it resolves the
		// buf/validate constraints but is never itself generated).
		mustRunInDir(
			// #nosec G204 -- repoRoot is derived from `go env GOMOD`, not user input.
			exec.CommandContext(gCtx, "go", "tool", "buf", "generate",
				"--template", filepath.Join(repoRoot, "buf.gen.yaml"), filepath.Join(repoRoot, "proto")),
			mod.Name(),
		)
		// The TypeScript target (buf.gen.web.yaml: protoc-gen-es) comes from pnpm,
		// so it runs only where a JS toolchain exists (dev machines, the CI lint
		// job) and is skipped otherwise (e.g. the Docker build image). The
		// generated TypeScript is a client artifact, never a compile input for the
		// Go binary. See docs/plans/09a-codegen-skeleton.md.
		if !pnpmAvailable() {
			log.Printf("`pnpm` not on PATH; skipping TypeScript proto codegen (buf.gen.web.yaml).")
			return nil
		}
		mustRunInDir(exec.CommandContext(gCtx, "pnpm", "install", "--frozen-lockfile"), repoRoot)
		mustRunInDir(
			// #nosec G204 -- repoRoot is derived from `go env GOMOD`, not user input.
			exec.CommandContext(gCtx, "go", "tool", "buf", "generate",
				"--template", filepath.Join(repoRoot, "buf.gen.web.yaml"), filepath.Join(repoRoot, "proto")),
			mod.Name(),
		)
		return nil
	})
	eg.Go(func() error {
		mustRunInDir(
			exec.CommandContext(gCtx, "go", "run", "fetchbuilddeps.go"),
			filepath.Join(mod.Name(), "bin", "fetchbuilddeps"),
		)
		return nil
	})
	must(eg.Wait())

	// The generated code (sqlc, templ, tsgo, buf) is intentionally not committed to
	// the repo, so it is produced at build time everywhere it's needed: locally, in
	// CI, and in the Docker build. `-generate-only` lets those callers run the
	// generators without the final `go build` (e.g. Docker builds the binary itself
	// with its own flags; CI compiles via `go test`).
	if *generateOnly {
		log.Printf("Code generation done in %v (skipped `go build`; -generate-only).", time.Since(start))
		return
	}

	// #nosec G204
	// The entry point is go/cmd/ocf-ims (plan 09f); build it explicitly since the
	// module root no longer holds a main package.
	mustRunInDir(exec.CommandContext(ctx, "go", "build", "-o", *outputApp, "./cmd/ocf-ims"), mod.Name())
	log.Printf("All done in %v. You can now run ./%v", time.Since(start), *outputApp)
}

// pnpmAvailable reports whether the pnpm executable is on PATH. It gates the
// TypeScript proto codegen (buf.gen.web.yaml), which needs a JS toolchain: dev
// machines and the CI lint job have pnpm; the golang:alpine Docker build stage
// does not, and skips that target.
func pnpmAvailable() bool {
	_, err := exec.LookPath("pnpm")
	return err == nil
}

func addTSGeneratedHeader(repo *os.Root, filename string) {
	// Read in the current version of the file.
	contents, err := repo.ReadFile(filename)
	must(err)

	// Re-open and truncate the file.
	f, err := repo.Create(filename)
	must(err)

	// WriteResponse the header, then the original file contents.
	_, err = f.WriteString("// Code generated by tsgo. DO NOT EDIT.\n\n")
	must(err)
	scanner := bufio.NewScanner(bytes.NewReader(contents))
	for scanner.Scan() {
		_, err = f.WriteString(scanner.Text())
		must(err)
		_, err = f.WriteString("\n")
		must(err)
	}
	must(f.Close())
}

func mustRunInDir(cmd *exec.Cmd, dir string) {
	start := time.Now()
	cmd.Dir = dir
	log.Printf("`%v`: running in %v", strings.Join(cmd.Args, " "), dir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("`%v`: failed!", strings.Join(cmd.Args, " "))
		log.Printf("failed command output:\n%v", string(output))
		must(err)
	}
	log.Printf("`%v`: succeeded in %v", strings.Join(cmd.Args, " "), time.Since(start))
}

// moduleRoot returns the Go module root — the directory holding go.mod. GOMOD is
// an absolute path to the active go.mod, so its directory is the module root.
func moduleRoot(ctx context.Context) string {
	cmd := exec.CommandContext(ctx, "go", "env", "GOMOD")
	goModPathBytes, err := cmd.CombinedOutput()
	must(err)
	modRoot := filepath.Dir(strings.TrimSpace(string(goModPathBytes)))
	if !pathExists(os.Stat(modRoot)) {
		must(fmt.Errorf("module root %v does not exist", modRoot))
	}
	return modRoot
}

// repoRootFrom returns the repo root — the nearest ancestor of the module root
// that holds buf.yaml. After the plan-09f relocation the Go module lives at go/
// while proto/ and the buf configs stay at the repo root (shared with the TS
// tier), so the two roots differ by one directory; walking up keeps this robust
// if the depth ever changes.
func repoRootFrom(modRoot string) string {
	dir := modRoot
	for {
		if pathExists(os.Stat(filepath.Join(dir, "buf.yaml"))) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			must(fmt.Errorf("repo root (dir holding buf.yaml) not found above module root %v", modRoot))
		}
		dir = parent
	}
}

func pathExists(_ os.FileInfo, err error) bool {
	return !os.IsNotExist(err)
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
