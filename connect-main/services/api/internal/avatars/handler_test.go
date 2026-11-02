package avatars

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func solid(width, height int, c color.Color) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, c)
		}
	}
	return img
}

func TestNormalize(t *testing.T) {
	var pngData, jpegData bytes.Buffer
	if err := png.Encode(&pngData, solid(400, 100, color.RGBA{R: 255, A: 255})); err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(&jpegData, solid(10, 30, color.RGBA{B: 255, A: 255}), nil); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{"png": pngData.Bytes(), "jpeg": jpegData.Bytes()} {
		out, err := Normalize(data)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		img, format, err := image.Decode(bytes.NewReader(out))
		if err != nil || format != "jpeg" || img.Bounds().Dx() != avatarSize || img.Bounds().Dy() != avatarSize {
			t.Errorf("%s: %v %s %v", name, err, format, img.Bounds())
		}
	}

	var transparent bytes.Buffer
	if err := png.Encode(&transparent, solid(8, 8, color.RGBA{})); err != nil {
		t.Fatal(err)
	}
	out, err := Normalize(transparent.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	img, _, _ := image.Decode(bytes.NewReader(out))
	if r, g, b, _ := img.At(10, 10).RGBA(); r>>8 < 250 || g>>8 < 250 || b>>8 < 250 {
		t.Errorf("transparency became %d %d %d", r>>8, g>>8, b>>8)
	}

	for name, data := range map[string][]byte{
		"text":      []byte("<svg onload=alert(1)>"),
		"empty":     {},
		"truncated": pngData.Bytes()[:20],
	} {
		if _, err := Normalize(data); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// A huge bitmap in a small file is refused from its header, before any memory is used for it.
	var bomb bytes.Buffer
	if err := png.Encode(&bomb, solid(6000, 6000, color.White)); err != nil {
		t.Fatal(err)
	}
	if _, err := Normalize(bomb.Bytes()); err == nil {
		t.Error("an oversized image was accepted")
	}
}
