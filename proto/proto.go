// Package proto is the single wire format shared by relay and agent.
package proto

// Msg is the only message type on the agent<->relay socket.
// []byte fields are base64-encoded automatically by encoding/json.
type Msg struct {
	Kind   string `json:"kind"`             // cmd | reply | event | frame | input
	Action string `json:"action,omitempty"` // for cmd: status/lock/sleep/shutdown/screenshot/stream-*
	Text   string `json:"text,omitempty"`   // human-readable reply/event text
	Data   []byte `json:"data,omitempty"`   // binary payload, e.g. a jpeg screenshot/frame
	Input  *Input `json:"input,omitempty"`  // for kind=input: a remote-control event
}

// Input is a remote-control event from a viewer. Pointer coords are normalized 0..1.
type Input struct {
	Type   string  `json:"t"`            // move | down | up | scroll | key
	X      float64 `json:"x,omitempty"`
	Y      float64 `json:"y,omitempty"`
	Button string  `json:"b,omitempty"`  // left | right | middle
	Key    string  `json:"k,omitempty"`  // browser KeyboardEvent.key
	Down   bool    `json:"d,omitempty"`  // key pressed vs released
	Dx     int     `json:"dx,omitempty"` // relative move delta x (trackpad)
	Dy     int     `json:"dy,omitempty"` // scroll direction (+1/-1) or relative move delta y
}
