package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const maxFileBytes = 20 << 20 // 20 MB cap each way

func readFileFor(path string) ([]byte, string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, "", errors.New(`usage:  /get <full\path\to\file>`)
	}
	fi, err := os.Stat(path)
	if err != nil {
		return nil, "", err
	}
	if fi.IsDir() {
		return nil, "", errors.New("that's a folder, not a file")
	}
	if fi.Size() > maxFileBytes {
		return nil, "", fmt.Errorf("file too big (%d MB, max 20)", fi.Size()>>20)
	}
	data, err := os.ReadFile(path)
	return data, filepath.Base(path), err
}

// listDir returns a directory's entries as JSON (dirs first). Empty path = home.
func listDir(path string) string {
	path = strings.TrimSpace(path)
	type entry struct {
		Name string `json:"name"`
		Dir  bool   `json:"dir"`
		Size int64  `json:"size"`
	}
	res := struct {
		Path    string  `json:"path"`
		Up      string  `json:"up"`
		Entries []entry `json:"entries"`
		Error   string  `json:"error,omitempty"`
	}{Path: path, Up: filepath.Dir(path)}
	// root view ("This PC"): list every drive. "\\" is the up-target from a drive root.
	if path == "" || path == "\\" {
		res.Path = ""
		res.Up = ""
		for _, d := range driveLetters() {
			res.Entries = append(res.Entries, entry{Name: d, Dir: true})
		}
		b, _ := json.Marshal(res)
		return string(b)
	}
	if len(path) <= 3 && strings.HasSuffix(path, ":\\") { // at a drive root → up to This PC
		res.Up = "\\"
	}
	items, err := os.ReadDir(path)
	if err != nil {
		res.Error = "can't open folder"
		b, _ := json.Marshal(res)
		return string(b)
	}
	for _, e := range items {
		var size int64
		if info, err := e.Info(); err == nil {
			size = info.Size()
		}
		res.Entries = append(res.Entries, entry{Name: e.Name(), Dir: e.IsDir(), Size: size})
	}
	sort.Slice(res.Entries, func(i, j int) bool {
		if res.Entries[i].Dir != res.Entries[j].Dir {
			return res.Entries[i].Dir
		}
		return strings.ToLower(res.Entries[i].Name) < strings.ToLower(res.Entries[j].Name)
	})
	b, _ := json.Marshal(res)
	return string(b)
}

func saveIncoming(name string, data []byte) (string, error) {
	dir := downloadDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name = filepath.Base(strings.TrimSpace(name)) // strip any path components -> no traversal
	if name == "" || name == "." {
		name = "sentivo-file.bin"
	}
	p := filepath.Join(dir, name)
	return p, os.WriteFile(p, data, 0o644)
}

func downloadDir() string {
	if downloadDirCfg != "" {
		return downloadDirCfg
	}
	return filepath.Join(os.Getenv("USERPROFILE"), "Downloads", "Sentivo")
}
