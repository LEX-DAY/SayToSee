package main

import (
	"net"
	"testing"
	"time"

	"github.com/hashicorp/mdns"
)

// Диагностика mDNS: регистрируем сервис и смотрим, видим ли его же запросом.
func TestMDNSDebug(t *testing.T) {
	ips := []net.IP{net.ParseIP(primaryLANIP())}
	t.Logf("primary LAN IP: %v", ips)
	service, err := mdns.NewMDNSService("debug-host", "saytosee", "local.", "", 18080, ips, []string{"key=TEST-KEY"})
	if err != nil {
		t.Fatalf("NewMDNSService: %v", err)
	}
	server, err := mdns.NewServer(&mdns.Config{Zone: service})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer server.Shutdown()
	time.Sleep(500 * time.Millisecond)

	entries := make(chan *mdns.ServiceEntry, 16)
	params := mdns.DefaultParams("saytosee")
	params.Timeout = 5 * time.Second
	params.DisableIPv6 = true
	params.Entries = entries
	go func() { _ = mdns.Query(params) }()

	deadline := time.After(6 * time.Second)
	found := 0
	for {
		select {
		case entry, ok := <-entries:
			if !ok {
				t.Logf("channel closed, found=%d", found)
				return
			}
			found++
			t.Logf("FOUND: name=%q ip=%v port=%d txt=%v",
				entry.Name, entry.AddrV4, entry.Port, entry.InfoFields)
		case <-deadline:
			if found == 0 {
				t.Log("за 5 секунд ничего не найдено — multicast не проходит")
			}
			return
		}
	}
}
