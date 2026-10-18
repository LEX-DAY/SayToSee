package main

import (
	"encoding/json"
	"net"
	"testing"
	"time"
)

// Проверка: доходит ли UDP-broadcast до слушателя на той же машине.
func TestUDPBroadcastLoop(t *testing.T) {
	listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		t.Fatalf("listener: %v", err)
	}
	defer listener.Close()

	sender, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.IPv4bcast, Port: listener.LocalAddr().(*net.UDPAddr).Port})
	if err != nil {
		t.Fatalf("sender: %v", err)
	}
	defer sender.Close()
	if err := sender.SetWriteBuffer(1024); err != nil {
		t.Log(err)
	}
	payload, _ := json.Marshal(map[string]string{"app": "saytosee"})
	if _, err := sender.Write(payload); err != nil {
		t.Fatalf("write: %v", err)
	}

	listener.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 1024)
	n, addr, err := listener.ReadFromUDP(buf)
	if err != nil {
		t.Fatalf("broadcast не дошёл: %v", err)
	}
	t.Logf("broadcast получен от %v: %s", addr, buf[:n])
}
