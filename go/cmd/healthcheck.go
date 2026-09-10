// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var healthCheckCmd = &cobra.Command{
	Use:   "healthcheck",
	Short: "Perform a health check against an IMS server",
	Long:  "Perform a health check against an IMS server",
	Run:   runHealthCheck,
}

var serverURL string

func init() {
	rootCmd.AddCommand(healthCheckCmd)

	healthCheckCmd.Flags().StringVar(&serverURL, "server_url", "", "The server URL and port of an IMS server")
	_ = healthCheckCmd.MarkFlagRequired("server_url")
}

func runHealthCheck(cmd *cobra.Command, args []string) {
	os.Exit(runHealthCheckInternal(cmd.Context(), serverURL))
}

func runHealthCheckInternal(ctx context.Context, serverURL string) int {
	client := http.Client{Timeout: time.Second * 5}

	pingURL, err := url.JoinPath(serverURL, "ims/api/ping")
	must(err)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pingURL, nil)
	must(err)

	// #nosec G704 // SSRF via taint analysis. The URL is hardcoded.
	resp, err := client.Do(req)
	must(err)

	body, err := io.ReadAll(resp.Body)
	must(err)
	_ = resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Println("wanted status code 200, got", resp.StatusCode) //nolint:forbidigo
		return 5
	}
	if strings.TrimSpace(string(body)) != "ack" {
		fmt.Printf("wanted response of 'ack', got '%v'\n", string(body)) //nolint:forbidigo
		return 6
	}
	fmt.Println("OK") //nolint:forbidigo
	return 0
}
