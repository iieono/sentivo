package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

// Expo's push service relays to FCM using the FCM V1 key uploaded to the Expo project,
// so the relay never holds Google credentials — it just POSTs here.
const expoPushURL = "https://exp.host/--/api/v2/push/send"

var pushClient = &http.Client{Timeout: 10 * time.Second}

// push sends a notification to every registered device of the account. Fire-and-forget.
func (a *account) push(title, body string) {
	tokens := a.pushTokenList()
	if len(tokens) == 0 {
		return
	}
	msgs := make([]map[string]any, 0, len(tokens))
	for _, t := range tokens {
		msgs = append(msgs, map[string]any{
			"to":        t,
			"title":     title,
			"body":      body,
			"priority":  "high",
			"channelId": "default",
			"sound":     "default",
		})
	}
	b, err := json.Marshal(msgs)
	if err != nil {
		return
	}
	go func() {
		req, err := http.NewRequest("POST", expoPushURL, bytes.NewReader(b))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := pushClient.Do(req)
		if err != nil {
			log.Printf("push: send failed: %v", err)
			return
		}
		defer resp.Body.Close()
		rb, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if resp.StatusCode != 200 || bytes.Contains(rb, []byte(`"status":"error"`)) {
			log.Printf("push: %d %s", resp.StatusCode, rb) // surface DeviceNotRegistered / bad-credential replies
		}
	}()
}
