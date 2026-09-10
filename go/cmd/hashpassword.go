// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/mikeki/ocf-ims/lib/argon2id"
	"github.com/spf13/cobra"
)

var hashPasswordCmd = &cobra.Command{
	Use:   "hash_password",
	Short: "Get a salted hash of a password",
	Long: "Get a salted hash of a password\n\n" +
		"The result will be of the form ${salt}:${hashedPassword}",
	Run: runHashPassword,
}

// password gets passed in as a flag.
var password string

func init() {
	rootCmd.AddCommand(hashPasswordCmd)

	hashPasswordCmd.Flags().StringVar(&password, "password", "", "The password to hash")
	_ = hashPasswordCmd.MarkFlagRequired("password")
}

func runHashPassword(cmd *cobra.Command, args []string) {
	fmt.Println(argon2id.CreateHash(password, argon2id.DefaultParams)) //nolint:forbidigo
}
