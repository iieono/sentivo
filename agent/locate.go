package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var locateClient = &http.Client{Timeout: 10 * time.Second}

// locate reports the laptop's approximate position via IP geolocation — coarse
// (city-level) but reliable and dependency-free, unlike Bluetooth RSSI. This is
// the real "find my laptop" answer for a stolen device.
func locate() string {
	resp, err := locateClient.Get("http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,isp,query")
	if err != nil {
		return "locate failed: " + err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return parseLocate(body)
}

func parseLocate(body []byte) string {
	var r struct {
		Status     string
		Country    string
		RegionName string
		City       string
		ISP        string
		Query      string
		Lat        float64
		Lon        float64
	}
	if json.Unmarshal(body, &r) != nil || r.Status != "success" {
		return "locate failed"
	}
	return fmt.Sprintf("📍 %s, %s, %s\nISP: %s\nIP: %s\nhttps://maps.google.com/?q=%.5f,%.5f",
		r.City, r.RegionName, r.Country, r.ISP, r.Query, r.Lat, r.Lon)
}
