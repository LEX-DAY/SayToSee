package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmbeddedServerURL(t *testing.T) {
	app := NewApp()
	if app.getServerURL() != "https://89.169.153.186" {
		t.Fatalf("unexpected embedded server URL: %s", app.getServerURL())
	}
}

func TestMeetingKeyFormatting(t *testing.T) {
	got := formatMeetingKey("abcd efgh-ikmo-pqrs")
	if got != "ABCD-EFGH-1KM0-PQRS" {
		t.Fatalf("unexpected key: %s", got)
	}
}

func TestCreateRoomAndJoin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/rooms":
			_ = json.NewEncoder(writer).Encode(map[string]string{
				"room":           "ctc-0123456789abcdef",
				"key":            "0123-4567-89AB-CDEF",
				"inviteUrl":      "https://0.0.0.0:3000/?key=0123-4567-89AB-CDEF",
				"hostCredential": "host-secret",
			})
		case "/api/token":
			var body map[string]string
			_ = json.NewDecoder(request.Body).Decode(&body)
			if body["hostCredential"] != "host-secret" {
				t.Error("host credential was not forwarded")
			}
			_ = json.NewEncoder(writer).Encode(tokenResponse{
				Token:     "participant-token",
				ServerURL: "wss://media.example",
				IsHost:    true,
				Room:      "ctc-0123456789abcdef",
				Key:       "0123-4567-89AB-CDEF",
			})
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	app := NewApp()
	app.apiBaseURL = server.URL
	session, err := app.CreateRoom("Анна")
	if err != nil {
		t.Fatal(err)
	}
	if !session.IsHost || session.DisplayName != "Анна" || session.InviteURL == "" {
		t.Fatalf("unexpected session: %#v", session)
	}
	if session.InviteURL != server.URL+"/?key=0123-4567-89AB-CDEF" {
		t.Fatalf("server response overrode the invite URL: %s", session.InviteURL)
	}
}
