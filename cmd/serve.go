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

package cmd

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/mikeki/ocf-ims/api"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/mikeki/ocf-ims/lib/securityheaders"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/actionlog"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/mikeki/ocf-ims/web"
	"github.com/spf13/cobra"
)

const (
	envfileFlagName    = "envfile"
	envFileDefaultName = ".env"

	printConfigFlagName = "print-config"
)

// serveCmd represents the serve command.
var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Launch the IMS server",
	Long: "Launch the IMS server\n\n" +
		"Configuration will be read from .env, and can be overridden by environment variables.",
	Run: runServer,
}

func runServer(cmd *cobra.Command, args []string) {
	baseCfg := conf.DefaultIMS()
	imsCfg := mustApplyEnvConfig(baseCfg, envFilename)
	// We don't actually use this chan outside tests, but it needs to be passed in
	// as a dummy value.
	started := make(chan struct{}, 1)
	os.Exit(runServerInternal(context.Background(), imsCfg, printConfig, started))
}

// runServerInternal starts the IMS server and blocks until it is terminated.
//
// The supplied channel will be written one time, at the point when
// the server is started and ready to accept connections. That channel is
// really only intended for testing usage.
func runServerInternal(
	ctx context.Context, unvalidatedCfg *conf.IMSConfig,
	printConfig bool, started chan<- struct{},
) (exitCode int) {
	server := mustStartServer(ctx, unvalidatedCfg, printConfig)
	started <- struct{}{}

	notifyCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	// The goroutine blocks here until the OS tells the process to shut down.
	<-notifyCtx.Done()
	stop()
	slog.Error("Shutting down gracefully, press Ctrl+C again to force")

	// Tell the server to shut down, giving it some time to do so gracefully.
	// Don't parent this ctx on the notifyCtx, because the notifyCtx is already done.
	timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	err := server.Shutdown(timeoutCtx)
	slog.Error("Server shut down", "err", err)
	stop()
	cancel()
	return 69
}

// mustStartServer configures and starts the IMS server, returning once that server
// is running and able to accept connections.
func mustStartServer(ctx context.Context, unvalidatedCfg *conf.IMSConfig, printConfig bool) *http.Server {
	must(unvalidatedCfg.Validate())
	imsCfg := unvalidatedCfg
	configureLogger(imsCfg)
	tuneMemoryLimit("/sys/fs/cgroup/memory/memory.stat")
	if printConfig {
		cfgStr := imsCfg.PrintRedacted()
		stderrPrintf("Here's the final redacted IMSConfig:\n\n%v\n\n", cfgStr)
		stderrPrintf("With JWTSecret: %v...%v\n", imsCfg.Core.JWTSecret[:1], imsCfg.Core.JWTSecret[len(imsCfg.Core.JWTSecret)-1:])
	}

	var s3Client *attachment.S3Client
	if imsCfg.AttachmentsStore.Type == conf.AttachmentsStoreS3 {
		var err error
		s3Client, err = attachment.NewS3Client(ctx)
		must(err)
	}

	imsDB, err := store.SqlDB(ctx, imsCfg.Store, true)
	must(err)
	// Load the selected seed dataset into an empty DB on boot (idempotent).
	// Defaults to none in production, which gets a schema-only database.
	if imsCfg.Store.Type == conf.DBStoreTypeMaria {
		must(store.Seed(ctx, imsDB, imsCfg.Core.Seed))
	}
	imsDBQ := store.NewDBQ(imsDB, imsdb.New())

	// The user/personnel directory is the local IMS-DB people tables
	// (PERSON/POSITION/TEAM). See docs/plans/32-retire-clubhouse.md.
	slog.Info("Using local IMS-DB people directory")
	var userStore directory.UserStore = directory.NewLocalUserStore(imsDBQ, imsCfg.Directory.InMemoryCacheTTL)
	actionLogger := actionlog.NewLogger(ctx, imsDBQ, imsCfg.Core.ActionLogEnabled, false)

	// Web-push send backend (plan 84c): a real VAPID-signing sender when push is
	// configured, else a no-op so the fan-out does nothing.
	var pushSender push.Sender = push.NoopSender{}
	if imsCfg.Push.Enabled() {
		slog.Info("Web push enabled")
		pushSender = push.NewWebPushSender(imsCfg.Push.VAPIDPublicKey, imsCfg.Push.VAPIDPrivateKey, imsCfg.Push.VAPIDSubject)
	}

	eventSource := api.NewEventSourcerer()
	mux := http.NewServeMux()
	api.AddToMux(mux, eventSource, imsCfg, imsDBQ, userStore, s3Client, actionLogger, pushSender)
	web.AddToMux(mux, imsCfg)

	s := &http.Server{
		// Wrap the combined API+web mux so every response carries the hardening
		// headers (plan 90 finding L2). HSTS is set by Caddy, not here.
		Handler:     securityheaders.Handler(mux),
		ReadTimeout: 1 * time.Minute,
		// This needs to be long to support long-lived EventSource calls.
		// After this duration, a client will be disconnected and forced
		// to reconnect.
		WriteTimeout:   30 * time.Minute,
		MaxHeaderBytes: 1 << 20,
	}
	s.RegisterOnShutdown(func() {
		actionLogger.Close()
		eventSource.Server.Close()
	})

	listener, err := net.Listen("tcp", net.JoinHostPort(imsCfg.Core.Host, conv.FormatInt(imsCfg.Core.Port)))
	must(err)
	addr := net.JoinHostPort(imsCfg.Core.Host, conv.FormatInt(listener.Addr().(*net.TCPAddr).Port))

	go func() {
		err := s.Serve(listener)
		slog.Error("Serve", "err", err)
	}()

	slog.Info("IMS server is ready for connections", "addr", addr)
	slog.Info(fmt.Sprintf("Visit the web frontend at http://%v/ims/app", addr))

	_, _ = fmt.Fprint(os.Stderr, `
[31m  ▀█▀ █▄█ █▀▀   █▀▄ █ █ █▀█ █▀█ ▀█▀ █▀█ █▀▀ █  [0m
[32m   █  █ █ ▀▀█   █▀▄ █ █ █ █ █ █  █  █ █ █ █ ▀  [0m
[34m  ▀▀▀ ▀ ▀ ▀▀▀   ▀ ▀ ▀▀▀ ▀ ▀ ▀ ▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀  [0m

`)

	return s
}

// tuneMemoryLimit sets the Go memory limit to something reasonable, given the memory limit
// imposed on Fargate ECS. This function is a no-op if the program isn't running as a container
// on Fargate ECS.
//
// From https://tip.golang.org/doc/gc-guide#Suggested_uses:
//
//	Do take advantage of the memory limit when the execution environment of your
//	Go program is entirely within your control, and the Go program is the only
//	program with access to some set of resources (i.e. some kind of memory reservation,
//	like a container memory limit).
func tuneMemoryLimit(cgroupMemStatFile string) {
	if os.Getenv("GOMEMLIMIT") != "" {
		// #nosec G706 // log injection
		slog.Info("GOMEMLIMIT was set in the environment, so we won't override it", "GOMEMLIMIT", os.Getenv("GOMEMLIMIT"))
		return
	}
	var memLimitBytes int64
	cgroupMemStat, err := os.ReadFile(filepath.Clean(cgroupMemStatFile))
	if err != nil {
		return
	}
	slog.Debug("found cgroup memory.stat file", "contents", string(cgroupMemStat), "err", err)
	const targetLine = "hierarchical_memory_limit "
	for line := range strings.SplitSeq(string(cgroupMemStat), "\n") {
		if after, ok := strings.CutPrefix(line, targetLine); ok {
			memLimitStr := after
			memLimitBytes, err = conv.ParseInt64(memLimitStr)
			if err != nil {
				slog.Error("Error parsing memory limit", "err", err)
				return
			}
			break
		}
	}
	if memLimitBytes != 0 {
		// reduce by 20%, to allow for any other memory overhead needed in the VM.
		newMemLimitBytes := memLimitBytes / 5 * 4
		debug.SetMemoryLimit(newMemLimitBytes)
		slog.Info("Set Go memory limit below the cgroup-permitted amount",
			"cgroup-memlimit", memLimitBytes,
			"GOMEMLIMIT", newMemLimitBytes,
		)
		return
	}
}

func configureLogger(imsCfg *conf.IMSConfig) {
	var logLevel slog.Level
	must(logLevel.UnmarshalText([]byte(imsCfg.Core.LogLevel)))
	slog.SetLogLoggerLevel(logLevel)
}

var (
	envFilename string
	printConfig bool
)

func init() {
	rootCmd.AddCommand(serveCmd)
	serveCmd.Flags().StringVar(&envFilename, envfileFlagName, envFileDefaultName,
		"An env file from which to load IMS server configuration. "+
			"Defaults to '.env' in the current directory")
	serveCmd.Flags().BoolVar(&printConfig, printConfigFlagName, true,
		"Whether to print the redacted IMSConfig on server startup")
}

// must logs an error and panics. This should only be done for
// startup errors, not after the server is up and running.
func must(err error) {
	if err != nil {
		panic("got a startup error: " + err.Error())
	}
}

func stderrPrintf(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, format, args...)
}
