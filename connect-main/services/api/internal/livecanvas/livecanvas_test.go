package livecanvas

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestParseDeck_CleansAndKeepsUsableSlides(t *testing.T) {
	raw := "```json\n" + `{
	  "title": "Sorting",
	  "slides": [
	    {"layout": "title", "title": "Sorting algorithms", "subtitle": "Week 4", "bullets": ["dropped"]},
	    {"layout": "table", "title": "Costs", "table": {"headers": ["Algo","Best","Worst"], "rows": [["Bubble","n","n^2"]]}},
	    {"layout": "code", "title": "Bubble", "code": {"language": "cpp", "source": "for(;;){}"}},
	    {"layout": "comparison", "title": "Merge vs quick", "left": {"heading": "Merge", "bullets": ["stable"]}, "right": {"heading": "Quick", "bullets": ["in place"]}},
	    {"layout": "steps", "title": "Empty steps", "steps": [], "bullets": ["falls back"]},
	    {"layout": "hologram", "title": "Unknown layout", "bullets": ["shown as bullets"]},
	    {"layout": "bullets", "title": "", "bullets": []},
	    {"layout": "code", "title": "No code"}
	  ]
	}` + "\n```"
	deck, err := ParseDeck(raw, MaxGeneratedSlides)
	if err != nil {
		t.Fatal(err)
	}
	if len(deck.Slides) != 6 {
		t.Fatalf("want 6 slides, got %d: %+v", len(deck.Slides), deck.Slides)
	}
	if deck.Slides[0].Bullets != nil || deck.Slides[0].Subtitle != "Week 4" {
		t.Errorf("title slide kept other fields: %+v", deck.Slides[0])
	}
	if deck.Slides[4].Layout != "bullets" || deck.Slides[4].Bullets[0] != "falls back" {
		t.Errorf("empty steps should fall back to bullets: %+v", deck.Slides[4])
	}
	if deck.Slides[5].Layout != "bullets" {
		t.Errorf("unknown layout: %+v", deck.Slides[5])
	}
}

func TestParseDeck_LimitsSizes(t *testing.T) {
	slides := []map[string]any{}
	for i := 0; i < 30; i++ {
		slides = append(slides, map[string]any{"layout": "bullets", "title": strings.Repeat("t", 500), "bullets": []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}})
	}
	raw, _ := json.Marshal(map[string]any{"slides": slides})
	deck, err := ParseDeck(string(raw), MaxGeneratedSlides)
	if err != nil {
		t.Fatal(err)
	}
	if len(deck.Slides) != MaxGeneratedSlides {
		t.Errorf("slides: %d", len(deck.Slides))
	}
	if n := len([]rune(deck.Slides[0].Title)); n != maxTitle {
		t.Errorf("title length %d", n)
	}
	if len(deck.Slides[0].Bullets) != maxBullets {
		t.Errorf("bullets: %d", len(deck.Slides[0].Bullets))
	}
}

func TestParseDeck_RejectsUnusable(t *testing.T) {
	for _, raw := range []string{"not json", `{"slides": []}`, `{"title":"x","slides":[{"layout":"bullets"}]}`} {
		if _, err := ParseDeck(raw, MaxGeneratedSlides); !errors.Is(err, ErrInvalidDeck) {
			t.Errorf("%q: %v", raw, err)
		}
	}
}

func TestNormalizeParams_ClampsAndDefaults(t *testing.T) {
	got, err := NormalizeParams("projectile", map[string]any{"angle": 400.0, "speed": "fast", "evil": "<script>", RunKey: 3.0})
	if err != nil {
		t.Fatal(err)
	}
	if got["angle"] != 85.0 || got["speed"] != 20.0 || got[RunKey] != 3.0 {
		t.Errorf("projectile: %v", got)
	}
	if _, ok := got["evil"]; ok {
		t.Error("unknown key kept")
	}
	sorting, _ := NormalizeParams("sorting", map[string]any{"algorithm": "QUICK", "size": 12.6})
	if sorting["algorithm"] != "quick" || sorting["size"] != 13.0 {
		t.Errorf("sorting: %v", sorting)
	}
	logic, _ := NormalizeParams("logic", map[string]any{"circuit": "rm -rf"})
	if logic["circuit"] != "xor" {
		t.Errorf("logic: %v", logic)
	}
	if _, err := NormalizeParams("webgl-anything", nil); !errors.Is(err, ErrUnknownEngine) {
		t.Errorf("unknown engine: %v", err)
	}
}

func TestNormalizeParams_Processes(t *testing.T) {
	list := []any{}
	for i := 0; i < 9; i++ {
		list = append(list, map[string]any{"name": "a-very-long-process-name", "arrival": -4.0, "burst": 99.0})
	}
	got, _ := NormalizeParams("scheduling", map[string]any{"processes": list})
	procs := got["processes"].([]Process)
	if len(procs) != 6 || procs[0].Arrival != 0 || procs[0].Burst != 15 || len([]rune(procs[0].Name)) > 8 {
		t.Errorf("processes: %+v", procs)
	}
	got, _ = NormalizeParams("scheduling", map[string]any{"processes": "nope"})
	if len(got["processes"].([]Process)) != len(defaultProcesses) {
		t.Error("default processes missing")
	}
}

func TestParseSimulation(t *testing.T) {
	sim, params, err := ParseSimulation(`{"engine":"Pendulum","title":"Simple pendulum","explanation":"Period depends on length.","observe":["Double the length"],"params":{"length":2}}`)
	if err != nil {
		t.Fatal(err)
	}
	if sim.Engine != "pendulum" || params["length"] != 2.0 || params["gravity"] != 9.8 {
		t.Errorf("%+v %v", sim, params)
	}
	if _, _, err := ParseSimulation(`{"engine":"html","params":{}}`); !errors.Is(err, ErrUnknownEngine) {
		t.Errorf("html engine: %v", err)
	}
}

func TestNormalizeParams_TreeAndGraph(t *testing.T) {
	tree, err := NormalizeParams("tree", map[string]any{"values": []any{5.0, 5.0, 300.0, "x", -2.0}, "kind": "AVL"})
	if err != nil {
		t.Fatal(err)
	}
	if got := tree["values"].([]int); len(got) != 3 || got[0] != 5 || got[1] != 99 || got[2] != 1 {
		t.Errorf("tree values: %v", got)
	}
	if tree["kind"] != "avl" {
		t.Errorf("kind: %v", tree["kind"])
	}
	graph, _ := NormalizeParams("graph", map[string]any{
		"nodes": 4.0, "start": 9.0,
		"edges": []any{
			map[string]any{"from": 0.0, "to": 1.0, "weight": 50.0},
			map[string]any{"from": 1.0, "to": 0.0, "weight": 3.0}, // duplicate of 0-1
			map[string]any{"from": 2.0, "to": 2.0},                // self loop
			map[string]any{"from": 0.0, "to": 6.0},                // beyond nodes
			map[string]any{"from": 2.0, "to": 3.0},
		},
	})
	edges := graph["edges"].([]Edge)
	if len(edges) != 2 || edges[0].Weight != 20 || edges[1].Weight != 1 {
		t.Errorf("edges: %+v", edges)
	}
	if graph["start"] != 3.0 {
		t.Errorf("start clamped to last node: %v", graph["start"])
	}
	empty, _ := NormalizeParams("graph", map[string]any{"nodes": 3.0})
	for _, e := range empty["edges"].([]Edge) {
		if e.From >= 3 || e.To >= 3 {
			t.Errorf("default edge outside 3 nodes: %+v", e)
		}
	}
}

func TestCleanSlide_Diagram(t *testing.T) {
	slide, ok := CleanSlide(Slide{Layout: "diagram", Title: "TCP handshake", Diagram: &Diagram{
		Nodes: []DiagramNode{{ID: "a", Label: "Client", Shape: "pill"}, {ID: "b", Label: "Server", Shape: "cylinder"}, {ID: "a", Label: "dupe"}, {ID: "c", Label: "Check", Shape: "hexagon"}},
		Edges: []DiagramEdge{{From: "a", To: "b", Label: "SYN"}, {From: "a", To: "b", Label: "again"}, {From: "b", To: "zzz"}, {From: "b", To: "c"}},
	}})
	if !ok || slide.Diagram == nil {
		t.Fatalf("diagram dropped: %+v", slide)
	}
	if len(slide.Diagram.Nodes) != 3 || slide.Diagram.Nodes[2].Shape != "rect" {
		t.Errorf("nodes: %+v", slide.Diagram.Nodes)
	}
	if len(slide.Diagram.Edges) != 2 || slide.Diagram.Edges[0].Label != "SYN" {
		t.Errorf("edges: %+v", slide.Diagram.Edges)
	}
	if _, ok := CleanSlide(Slide{Layout: "diagram", Title: "x", Diagram: &Diagram{Nodes: []DiagramNode{{ID: "a", Label: "only"}}}}); ok {
		t.Error("a one-node diagram with no bullets should be dropped")
	}
}
