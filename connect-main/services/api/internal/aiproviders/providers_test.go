package aiproviders

import (
	"errors"
	"testing"
)

func TestCostMicroUSD(t *testing.T) {
	prices := PriceTable{"m": {InputMicroUSDPerMTok: 1_000_000, OutputMicroUSDPerMTok: 5_000_000}}

	cases := []struct {
		name  string
		usage Usage
		want  int64
	}{
		{"zero", Usage{}, 0},
		{"exact", Usage{InputTokens: 1000, OutputTokens: 1000}, 6000},
		{"rounds up", Usage{OutputTokens: 1}, 5},
		{"fraction rounds up", Usage{InputTokens: 1, OutputTokens: 0}, 1},
	}
	for _, tc := range cases {
		got, err := prices.CostMicroUSD("m", tc.usage)
		if err != nil || got != tc.want {
			t.Errorf("%s: got %d, %v; want %d", tc.name, got, err, tc.want)
		}
	}
}

func TestCostMicroUSD_UnknownModelIsAnError(t *testing.T) {
	if _, err := (PriceTable{}).CostMicroUSD("x", Usage{InputTokens: 1}); !errors.Is(err, ErrUnknownModel) {
		t.Fatalf("expected ErrUnknownModel, got %v", err)
	}
}
