//go:build windows

package main

import (
	"image"
	"image/color"
	"unsafe"
)

type winPoint struct{ X, Y int32 }

func cursorPos() (int, int, bool) {
	var p winPoint
	r, _, _ := pGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	if r == 0 {
		return 0, 0, false
	}
	return int(p.X), int(p.Y), true
}

// classic arrow: 'X' = white fill, '.' = black outline, ' ' = transparent.
var cursorArrow = []string{
	"X       ",
	"X.      ",
	"X..     ",
	"X...    ",
	"X....   ",
	"X.....  ",
	"X...... ",
	"X.......",
	"X....XXX",
	"X..X..  ",
	"X.X X.. ",
	"XX  X.. ",
	"X    X..",
	"     X..",
	"      X.",
}

var cWhite = color.RGBA{255, 255, 255, 255}
var cBlack = color.RGBA{0, 0, 0, 255}

// drawCursor paints the mouse pointer onto a captured frame — the screen-grab (BitBlt) omits it,
// which made remote control feel blind. Cursor coords are screen-space = primary-display pixels.
func drawCursor(img *image.RGBA) {
	x, y, ok := cursorPos()
	if !ok {
		return
	}
	b := img.Bounds()
	for j, row := range cursorArrow {
		for i, ch := range row {
			if ch == ' ' {
				continue
			}
			px, py := x+i, y+j
			if px < b.Min.X || px >= b.Max.X || py < b.Min.Y || py >= b.Max.Y {
				continue
			}
			if ch == 'X' {
				img.SetRGBA(px, py, cWhite)
			} else {
				img.SetRGBA(px, py, cBlack)
			}
		}
	}
}
