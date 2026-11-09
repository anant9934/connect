package runner

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPiston(t *testing.T) {
	var got map[string]any
	reply := `{"run":{"stdout":"42\n","stderr":"","code":0,"wall_time":12}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/execute" {
			t.Errorf("path %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(reply))
	}))
	defer srv.Close()
	run := New("piston", srv.URL, "")
	res, err := run.Run(context.Background(), Job{Language: "cpp", Source: "int main(){}", Stdin: "6 7"})
	if err != nil || res.Status != "ok" || res.Stdout != "42\n" {
		t.Fatalf("%+v %v", res, err)
	}
	if got["language"] != "c++" || got["stdin"] != "6 7" || got["run_timeout"] != float64(DefaultTimeMS) {
		t.Errorf("request: %v", got)
	}
	reply = `{"compile":{"stderr":"main.cpp:1: error","code":1},"run":{}}`
	if res, _ := run.Run(context.Background(), Job{Language: "cpp", Source: "x"}); res.Status != "compile_error" || !strings.Contains(res.CompileOutput, "error") {
		t.Errorf("compile error: %+v", res)
	}
	reply = `{"run":{"stdout":"","code":null,"signal":"SIGKILL","status":"TO","wall_time":2000}}`
	if res, _ := run.Run(context.Background(), Job{Language: "java", Source: "class Main{}"}); res.Status != "time_limit" {
		t.Errorf("timeout: %+v", res)
	}
	reply = `{"run":{"stdout":"","stderr":"Segmentation fault","code":139}}`
	if res, _ := run.Run(context.Background(), Job{Language: "cpp", Source: "x"}); res.Status != "runtime_error" {
		t.Errorf("runtime error: %+v", res)
	}
}

func TestJudge0(t *testing.T) {
	var got map[string]any
	status := 3
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("wait") != "true" || r.Header.Get("X-Auth-Token") != "tok" {
			t.Errorf("request: %s %v", r.URL, r.Header)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(map[string]any{"stdout": "hi\n", "time": "0.015", "exit_code": 0, "status": map[string]int{"id": status}})
	}))
	defer srv.Close()
	run := New("judge0", srv.URL, "tok")
	res, err := run.Run(context.Background(), Job{Language: "java", Source: "class Main{}", TimeLimitMS: 99999})
	if err != nil || res.Stdout != "hi\n" || res.TimeMS != 15 {
		t.Fatalf("%+v %v", res, err)
	}
	if got["language_id"] != float64(62) || got["cpu_time_limit"] != float64(MaxTimeMS)/1000 {
		t.Errorf("request: %v", got)
	}
	for id, want := range map[int]string{4: "ok", 5: "time_limit", 6: "compile_error", 11: "runtime_error"} {
		status = id
		if res, _ := run.Run(context.Background(), Job{Language: "cpp", Source: "x"}); res.Status != want {
			t.Errorf("status %d -> %s, want %s", id, res.Status, want)
		}
	}
	status = 13
	if _, err := run.Run(context.Background(), Job{Language: "cpp", Source: "x"}); !errors.Is(err, ErrUnavailable) {
		t.Errorf("internal error status: %v", err)
	}
}

func TestValidation(t *testing.T) {
	run := New("piston", "http://127.0.0.1:1", "")
	if _, err := run.Run(context.Background(), Job{Language: "python", Source: "print(1)"}); !errors.Is(err, ErrUnsupportedLanguage) {
		t.Errorf("python: %v", err)
	}
	if _, err := run.Run(context.Background(), Job{Language: "cpp", Source: strings.Repeat("x", MaxSourceBytes+1)}); err == nil {
		t.Error("oversized source accepted")
	}
	if _, err := run.Run(context.Background(), Job{Language: "cpp", Source: "x"}); !errors.Is(err, ErrUnavailable) {
		t.Errorf("unreachable runner: %v", err)
	}
	if New("hackerrank", "http://x", "") != nil {
		t.Error("unknown kind should be nil")
	}
	t.Setenv("CODE_RUNNER_URL", "")
	if FromEnv() != nil {
		t.Error("no URL should mean no runner")
	}
}
