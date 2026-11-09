package livecanvas

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// ErrUnknownEngine means a simulation names an engine the client cannot draw.
var ErrUnknownEngine = errors.New("unknown simulation engine")

// ErrInvalidSimulation means model output was not a usable simulation.
var ErrInvalidSimulation = errors.New("the simulation could not be read")

// RunKey is a counter the presenter raises to restart every screen's animation together.
const RunKey = "_run"

type number struct {
	min, max, def float64
	integer       bool
}

type choice struct {
	values []string
	def    string
}

type engine struct {
	numbers   map[string]number
	choices   map[string]choice
	processes bool
	values    bool // a list of distinct keys, for trees
	edges     bool // a weighted edge list, for graphs
}

// Engines lists every built-in simulation. The web client has a renderer for each and the
// same ranges (apps/web/features/classroom/simulations/specs.ts).
var engines = map[string]engine{
	"projectile": {numbers: map[string]number{
		"angle": {5, 85, 45, false}, "speed": {5, 50, 20, false}, "gravity": {1, 25, 9.8, false}, "height": {0, 50, 0, false},
	}},
	"pendulum": {numbers: map[string]number{
		"length": {0.2, 5, 1.5, false}, "gravity": {1, 25, 9.8, false}, "amplitude": {5, 80, 30, false}, "damping": {0, 0.5, 0.05, false},
	}},
	"function": {
		numbers: map[string]number{"a": {-10, 10, 1, false}, "b": {-10, 10, 1, false}, "c": {-10, 10, 0, false}},
		choices: map[string]choice{"family": {[]string{"linear", "quadratic", "cubic", "sine", "exponential", "logarithm"}, "sine"}},
	},
	"scheduling": {
		numbers:   map[string]number{"quantum": {1, 8, 2, true}},
		choices:   map[string]choice{"algorithm": {[]string{"fcfs", "sjf", "rr"}, "rr"}},
		processes: true,
	},
	"sorting": {
		numbers: map[string]number{"size": {5, 40, 16, true}, "speed": {1, 10, 4, false}, "seed": {1, 999, 7, true}},
		choices: map[string]choice{"algorithm": {[]string{"bubble", "insertion", "selection", "merge", "quick"}, "bubble"}},
	},
	"logic": {
		numbers: map[string]number{"a": {0, 1, 0, true}, "b": {0, 1, 1, true}, "c": {0, 1, 0, true}},
		choices: map[string]choice{"circuit": {[]string{"and", "or", "not", "nand", "nor", "xor", "xnor", "half_adder", "full_adder"}, "xor"}},
	},
	"perceptron": {
		numbers: map[string]number{"w1": {-3, 3, 1, false}, "w2": {-3, 3, 1, false}, "bias": {-3, 3, -1.5, false}},
		choices: map[string]choice{"dataset": {[]string{"and", "or", "xor"}, "and"}},
	},
	"tree": {
		numbers: map[string]number{"remove": {0, 99, 0, true}, "speed": {0.5, 5, 1.5, false}},
		choices: map[string]choice{
			"kind":      {[]string{"bst", "avl"}, "bst"},
			"traversal": {[]string{"none", "inorder", "preorder", "postorder", "levelorder"}, "inorder"},
		},
		values: true,
	},
	"graph": {
		numbers: map[string]number{"nodes": {3, 8, 6, true}, "start": {0, 7, 0, true}, "target": {0, 7, 5, true}, "speed": {0.5, 5, 1, false}},
		choices: map[string]choice{"algorithm": {[]string{"bfs", "dfs", "dijkstra"}, "dijkstra"}},
		edges:   true,
	},
}

// MaxTreeValues bounds a tree so it stays readable on one screen.
const MaxTreeValues = 15

// MaxGraphEdges bounds a graph for the same reason.
const MaxGraphEdges = 16

var defaultTreeValues = []int{50, 30, 70, 20, 40, 60, 80}

// Edge is one weighted, undirected edge between node indexes.
type Edge struct {
	From   int `json:"from"`
	To     int `json:"to"`
	Weight int `json:"weight"`
}

var defaultEdges = []Edge{{0, 1, 4}, {0, 2, 2}, {1, 2, 1}, {1, 3, 5}, {2, 4, 8}, {3, 4, 2}, {3, 5, 6}, {4, 5, 3}}

func readValues(v any) []int {
	list, ok := v.([]any)
	if !ok {
		return append([]int(nil), defaultTreeValues...)
	}
	seen := map[int]bool{}
	out := []int{}
	for _, item := range list {
		f, ok := toFloat(item)
		if !ok {
			continue
		}
		n := int(clamp(f, number{1, 99, 1, true}))
		if !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
		if len(out) == MaxTreeValues {
			break
		}
	}
	if len(out) == 0 {
		return append([]int(nil), defaultTreeValues...)
	}
	return out
}

func readEdges(v any, nodes int) []Edge {
	list, ok := v.([]any)
	out := []Edge{}
	seen := map[[2]int]bool{}
	if ok {
		for _, item := range list {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			from, ok1 := toFloat(m["from"])
			to, ok2 := toFloat(m["to"])
			weight, ok3 := toFloat(m["weight"])
			if !ok1 || !ok2 {
				continue
			}
			if !ok3 {
				weight = 1
			}
			a, b := int(math.Round(from)), int(math.Round(to))
			if a < 0 || b < 0 || a >= nodes || b >= nodes || a == b {
				continue
			}
			key := [2]int{min(a, b), max(a, b)}
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, Edge{a, b, int(clamp(weight, number{1, 20, 1, true}))})
			if len(out) == MaxGraphEdges {
				break
			}
		}
	}
	if len(out) == 0 {
		for _, e := range defaultEdges {
			if e.From < nodes && e.To < nodes {
				out = append(out, e)
			}
		}
	}
	return out
}

// EngineNames returns the engines in a stable order, for prompts and errors.
func EngineNames() []string {
	names := make([]string, 0, len(engines))
	for name := range engines {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Process is one job in a CPU scheduling simulation.
type Process struct {
	Name    string `json:"name"`
	Arrival int    `json:"arrival"`
	Burst   int    `json:"burst"`
}

var defaultProcesses = []Process{{"P1", 0, 5}, {"P2", 1, 3}, {"P3", 2, 8}, {"P4", 3, 2}}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case int:
		return float64(n), true
	}
	return 0, false
}

func clamp(v float64, spec number) float64 {
	v = math.Max(spec.min, math.Min(spec.max, v))
	if spec.integer {
		return math.Round(v)
	}
	return math.Round(v*1000) / 1000
}

func readProcesses(v any) []Process {
	list, ok := v.([]any)
	if !ok {
		return append([]Process(nil), defaultProcesses...)
	}
	out := []Process{}
	for i, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := m["name"].(string)
		if name = clip(name, 8); name == "" {
			name = fmt.Sprintf("P%d", i+1)
		}
		arrival, _ := toFloat(m["arrival"])
		burst, ok := toFloat(m["burst"])
		if !ok {
			burst = 1
		}
		out = append(out, Process{name, int(clamp(arrival, number{0, 20, 0, true})), int(clamp(burst, number{1, 15, 1, true}))})
		if len(out) == 6 {
			break
		}
	}
	if len(out) == 0 {
		return append([]Process(nil), defaultProcesses...)
	}
	return out
}

// NormalizeParams returns settings for an engine: known keys only, numbers clamped to their
// range, unknown choices replaced by the default, and missing values filled in.
func NormalizeParams(engineName string, raw map[string]any) (map[string]any, error) {
	spec, ok := engines[engineName]
	if !ok {
		return nil, ErrUnknownEngine
	}
	out := map[string]any{}
	for key, n := range spec.numbers {
		v, ok := toFloat(raw[key])
		if !ok {
			v = n.def
		}
		out[key] = clamp(v, n)
	}
	for key, c := range spec.choices {
		out[key] = c.def
		if v, ok := raw[key].(string); ok {
			for _, allowed := range c.values {
				if strings.EqualFold(v, allowed) {
					out[key] = allowed
				}
			}
		}
	}
	if spec.processes {
		out["processes"] = readProcesses(raw["processes"])
	}
	if spec.values {
		out["values"] = readValues(raw["values"])
	}
	if spec.edges {
		nodes := int(out["nodes"].(float64))
		out["edges"] = readEdges(raw["edges"], nodes)
		for _, key := range []string{"start", "target"} {
			if int(out[key].(float64)) >= nodes {
				out[key] = float64(nodes - 1)
			}
		}
	}
	if v, ok := toFloat(raw[RunKey]); ok {
		out[RunKey] = clamp(v, number{0, 1e9, 0, true})
	} else {
		out[RunKey] = float64(0)
	}
	return out, nil
}

// Simulation is the descriptive part of a generated simulation. Settings are stored apart,
// because the presenter changes them while the description stays fixed.
type Simulation struct {
	Engine      string   `json:"engine"`
	Title       string   `json:"title"`
	Explanation string   `json:"explanation"`
	Observe     []string `json:"observe"`
}

// ParseSimulation reads model output into a description and normalized starting settings.
func ParseSimulation(raw string) (*Simulation, map[string]any, error) {
	var in struct {
		Simulation
		Params map[string]any `json:"params"`
	}
	if err := json.Unmarshal([]byte(stripFence(raw)), &in); err != nil {
		return nil, nil, ErrInvalidSimulation
	}
	name := strings.ToLower(strings.TrimSpace(in.Engine))
	params, err := NormalizeParams(name, in.Params)
	if err != nil {
		return nil, nil, err
	}
	sim := &Simulation{
		Engine:      name,
		Title:       clip(in.Title, maxTitle),
		Explanation: clip(in.Explanation, 600),
		Observe:     clipList(in.Observe, 4, 200),
	}
	if sim.Title == "" {
		sim.Title = strings.ToUpper(name[:1]) + name[1:] + " simulation"
	}
	return sim, params, nil
}
