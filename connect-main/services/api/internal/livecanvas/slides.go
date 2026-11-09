// Package livecanvas validates what a host puts on the live classroom canvas: generated slide
// decks and simulation settings. Everything here is data a client renders. Nothing is code to
// run, so a model or a participant can never place script in another participant's browser.
package livecanvas

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

// Limits on a deck. The database allows up to 40 slides so edits never fail on size.
const (
	MaxGeneratedSlides = 12
	MaxSlides          = 40
	maxTitle           = 120
	maxText            = 240
	maxBullets         = 8
	maxColumns         = 6
	maxRows            = 10
	maxCell            = 80
	maxCodeChars       = 3000
	maxCodeLines       = 60
	maxSteps           = 8
	maxNotes           = 1000
)

// ErrInvalidDeck means the deck has no usable slide after cleaning.
var ErrInvalidDeck = errors.New("the deck has no usable slides")

// Layouts a client knows how to draw.
var layouts = map[string]bool{"title": true, "bullets": true, "table": true, "code": true, "steps": true, "comparison": true}

// Column is one side of a comparison slide.
type Column struct {
	Heading string   `json:"heading"`
	Bullets []string `json:"bullets"`
}

// Table is a small grid of text.
type Table struct {
	Headers []string   `json:"headers"`
	Rows    [][]string `json:"rows"`
}

// Code is a listing shown in monospace.
type Code struct {
	Language string `json:"language"`
	Source   string `json:"source"`
}

// Slide is one slide. Only the fields its layout uses are kept.
type Slide struct {
	Layout   string   `json:"layout"`
	Title    string   `json:"title"`
	Subtitle string   `json:"subtitle,omitempty"`
	Bullets  []string `json:"bullets,omitempty"`
	Table    *Table   `json:"table,omitempty"`
	Code     *Code    `json:"code,omitempty"`
	Steps    []string `json:"steps,omitempty"`
	Left     *Column  `json:"left,omitempty"`
	Right    *Column  `json:"right,omitempty"`
	Notes    string   `json:"notes,omitempty"`
}

// Deck is a generated presentation.
type Deck struct {
	Title  string  `json:"title"`
	Slides []Slide `json:"slides"`
}

func clip(s string, max int) string {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:max-1])) + "…"
}

func clipList(items []string, count, length int) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text := clip(item, length); text != "" {
			out = append(out, text)
		}
		if len(out) == count {
			break
		}
	}
	return out
}

func cleanColumn(c *Column) *Column {
	if c == nil {
		return nil
	}
	out := &Column{Heading: clip(c.Heading, maxTitle), Bullets: clipList(c.Bullets, maxBullets, maxText)}
	if out.Heading == "" && len(out.Bullets) == 0 {
		return nil
	}
	return out
}

// CleanSlide keeps what its layout uses, trims every string to its limit, and reports whether
// anything worth showing is left. An unknown layout is shown as bullets.
func CleanSlide(in Slide) (Slide, bool) {
	out := Slide{Layout: strings.ToLower(strings.TrimSpace(in.Layout)), Title: clip(in.Title, maxTitle), Notes: clip(in.Notes, maxNotes)}
	if !layouts[out.Layout] {
		out.Layout = "bullets"
	}
	switch out.Layout {
	case "title":
		out.Subtitle = clip(in.Subtitle, maxText)
		return out, out.Title != ""
	case "table":
		if in.Table != nil {
			t := &Table{Headers: clipList(in.Table.Headers, maxColumns, maxCell)}
			for _, row := range in.Table.Rows {
				cells := make([]string, 0, maxColumns)
				for i, cell := range row {
					if i == maxColumns {
						break
					}
					cells = append(cells, clip(cell, maxCell))
				}
				if len(cells) > 0 {
					t.Rows = append(t.Rows, cells)
				}
				if len(t.Rows) == maxRows {
					break
				}
			}
			if len(t.Headers) > 0 || len(t.Rows) > 0 {
				out.Table = t
				return out, true
			}
		}
	case "code":
		if in.Code != nil {
			source := strings.ToValidUTF8(in.Code.Source, "")
			lines := strings.Split(strings.Trim(source, "\n"), "\n")
			if len(lines) > maxCodeLines {
				lines = lines[:maxCodeLines]
			}
			source = strings.Join(lines, "\n")
			if len(source) > maxCodeChars {
				source = strings.ToValidUTF8(source[:maxCodeChars], "")
			}
			if strings.TrimSpace(source) != "" {
				out.Code = &Code{Language: clip(in.Code.Language, 24), Source: source}
				out.Bullets = clipList(in.Bullets, 3, maxText)
				return out, true
			}
		}
	case "steps":
		out.Steps = clipList(in.Steps, maxSteps, maxText)
		if len(out.Steps) > 0 {
			return out, true
		}
	case "comparison":
		out.Left, out.Right = cleanColumn(in.Left), cleanColumn(in.Right)
		if out.Left != nil && out.Right != nil {
			return out, true
		}
	}
	// The layout's own content was missing; fall back to any bullets the slide has.
	out.Layout = "bullets"
	out.Table, out.Code, out.Steps, out.Left, out.Right = nil, nil, nil, nil, nil
	out.Bullets = clipList(in.Bullets, maxBullets, maxText)
	return out, out.Title != "" && len(out.Bullets) > 0
}

// ParseDeck reads a deck from model output and cleans it. Slides with nothing to show are
// dropped; a deck with none left is an error.
func ParseDeck(raw string, maxSlides int) (*Deck, error) {
	var in Deck
	if err := json.Unmarshal([]byte(stripFence(raw)), &in); err != nil {
		return nil, ErrInvalidDeck
	}
	out := &Deck{Title: clip(in.Title, maxTitle)}
	for _, s := range in.Slides {
		if cleaned, ok := CleanSlide(s); ok {
			out.Slides = append(out.Slides, cleaned)
		}
		if len(out.Slides) == maxSlides {
			break
		}
	}
	if len(out.Slides) == 0 {
		return nil, ErrInvalidDeck
	}
	if out.Title == "" {
		out.Title = out.Slides[0].Title
	}
	return out, nil
}

// stripFence removes a ```json fence some models add despite being asked not to.
func stripFence(raw string) string {
	s := strings.TrimSpace(raw)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	return strings.TrimSpace(s)
}
