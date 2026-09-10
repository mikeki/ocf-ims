// SPDX-License-Identifier: Apache-2.0

package authz

import (
	"github.com/stretchr/testify/assert"
	"math/big"
	"slices"
	"testing"
)

func TestBitSet(t *testing.T) {
	t.Parallel()
	testcases := [][]int64{
		nil,
		{0},
		{1, 2, 3},
		{100, 200, 300},
		{0x1000, 0b1},
	}
	for _, tc := range testcases {
		bi := marshalBigInt(intsToBitSet(tc))
		output := bitSetToInts(unmarshalBigInt(bi))
		slices.Sort(tc)
		assert.Equal(t, tc, output)
	}
}

func TestBitSetInverse(t *testing.T) {
	t.Parallel()
	// base 62 numbers
	testcases := []string{
		"0",
		"100",
		"BurningMan",
	}

	for _, tc := range testcases {
		intSlice := bitSetToInts(unmarshalBigInt(tc))
		output := marshalBigInt(intsToBitSet(intSlice))
		assert.Equal(t, tc, output)
	}
}

func TestBitSetErrors(t *testing.T) {
	t.Parallel()
	assert.PanicsWithValue(t,
		"negative bit index",
		func() {
			intsToBitSet([]int64{-1})
		},
	)
	assert.PanicsWithValue(t,
		"got bigint less than zero",
		func() {
			bitSetToInts(big.NewInt(-1))
		},
	)

	assert.Equal(t, big.NewInt(0), unmarshalBigInt(""))
	assert.Equal(t, big.NewInt(0), unmarshalBigInt("Not base 62 💩"))
}

func BenchmarkBitSet(b *testing.B) {
	for b.Loop() {
		tc := "90000000000006102006000010e0"
		intSlice := bitSetToInts(unmarshalBigInt(tc))
		_ = marshalBigInt(intsToBitSet(intSlice))
	}
}
