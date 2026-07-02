package main

import (
	"image"
	"image/color"
	"testing"
)

func TestGridDiff(t *testing.T) {
	a := make([]float64, gridN*gridN)
	b := make([]float64, gridN*gridN)
	if d := gridDiff(a, b); d != 0 {
		t.Fatalf("identical grids diff = %v, want 0", d)
	}
	for i := range b {
		b[i] = 1
	}
	if d := gridDiff(a, b); d != 1 {
		t.Fatalf("black vs white diff = %v, want 1", d)
	}
}

func TestLumaGridBlackVsWhite(t *testing.T) {
	black := image.NewRGBA(image.Rect(0, 0, 64, 64)) // zero value = black
	white := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			white.Set(x, y, color.White)
		}
	}
	if d := gridDiff(lumaGrid(black), lumaGrid(white)); d < 0.9 {
		t.Fatalf("black vs white luma diff = %v, want ~1", d)
	}
}
