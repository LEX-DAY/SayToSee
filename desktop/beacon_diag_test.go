package main

import (
	"testing"
	"time"
)

// Диагностика отправки маячков.
func TestBeaconDiag(t *testing.T) {
	app := NewApp()
	app.startup(nil)
	t.Cleanup(func() { app.StopLANHost() })

	if _, err := app.StartLANHost("DiagHost"); err != nil {
		t.Fatalf("StartLANHost: %v", err)
	}
	time.Sleep(4 * time.Second)
	lan.mu.Lock()
	sent, beaconErr := lan.beaconSent, lan.beaconErr
	lan.mu.Unlock()
	t.Logf("beaconSent=%d beaconErr=%q", sent, beaconErr)
	if sent == 0 {
		t.Fatalf("маячки не отправляются: err=%q", beaconErr)
	}
}
