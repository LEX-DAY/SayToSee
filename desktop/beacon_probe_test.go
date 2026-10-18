package main

import (
	"time"
	"net"
	"os"
	"testing"
)

// Сырой слушатель 45616: слышны ли маячки хоста (без встроенного слушателя).
func TestBeaconProbe(t *testing.T) {
	if os.Getenv("SAYTOSEE_PROBE") != "1" {
		t.Skip("только для SAYTOSEE_PROBE=1")
	}
	app := NewApp()
	app.startup(nil)
	t.Cleanup(func() { app.StopLANHost() })

	probe, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: lanBeaconPort})
	if err != nil {
		t.Skipf("45616 занят: %v", err)
	}
	defer probe.Close()

	if _, err := app.StartLANHost("ProbeHost"); err != nil {
		t.Fatalf("StartLANHost: %v", err)
	}

	probe.SetReadDeadline(time.Now().Add(8 * time.Second))
	buf := make([]byte, 1024)
	n, addr, err := probe.ReadFromUDP(buf)
	if err != nil {
		t.Fatalf("маячки не дошли до сырого слушателя: %v", err)
	}
	t.Logf("PROBE GOT from %v: %s", addr, buf[:n])
}
