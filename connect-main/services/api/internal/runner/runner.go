// Package runner sends untrusted lab code to an isolated execution service the operator runs:
// a Piston or Judge0 CE instance. The API never compiles or runs code itself. With no runner
// configured, callers report that execution is unavailable; nothing is simulated.
package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// ErrNotConfigured means no execution service is set up.
var ErrNotConfigured = errors.New("no code runner is configured")

// ErrUnsupportedLanguage means the runner is not set up for this language.
var ErrUnsupportedLanguage = errors.New("this language cannot be run on the server")

// ErrUnavailable means the execution service failed or could not be reached.
var ErrUnavailable = errors.New("the code runner is unavailable")

// Limits applied to every job.
const (
	MaxSourceBytes   = 64 << 10
	MaxStdinBytes    = 64 << 10
	MaxOutputBytes   = 64 << 10
	DefaultTimeMS    = 2000
	MaxTimeMS        = 10000
	DefaultMemoryKB  = 256 << 10
	compileTimeoutMS = 10000
)

// Job is one program run.
type Job struct {
	Language    string // "cpp" or "java"
	Source      string
	Stdin       string
	TimeLimitMS int
}

// Result is what happened. Status is ok, compile_error, runtime_error, time_limit or memory_limit.
type Result struct {
	Status        string `json:"status"`
	Stdout        string `json:"stdout"`
	Stderr        string `json:"stderr"`
	CompileOutput string `json:"compileOutput"`
	ExitCode      int    `json:"exitCode"`
	TimeMS        int    `json:"timeMs"`
}

// Runner runs jobs.
type Runner interface {
	Run(ctx context.Context, job Job) (*Result, error)
	Kind() string
}

// FromEnv builds the runner named by CODE_RUNNER_KIND (piston or judge0) at CODE_RUNNER_URL,
// with an optional CODE_RUNNER_TOKEN. It returns nil when none is configured.
func FromEnv() Runner {
	kind := strings.ToLower(strings.TrimSpace(os.Getenv("CODE_RUNNER_KIND")))
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("CODE_RUNNER_URL")), "/")
	token := strings.TrimSpace(os.Getenv("CODE_RUNNER_TOKEN"))
	if base == "" {
		return nil
	}
	return New(kind, base, token)
}

// New returns a runner of the given kind, or nil for an unknown kind.
func New(kind, base, token string) Runner {
	client := &http.Client{Timeout: 30 * time.Second}
	switch kind {
	case "piston":
		return &piston{base: base, token: token, client: client}
	case "judge0":
		return &judge0{base: base, token: token, client: client}
	}
	return nil
}

func validate(job *Job) error {
	if job.Language != "cpp" && job.Language != "java" {
		return ErrUnsupportedLanguage
	}
	if strings.TrimSpace(job.Source) == "" || len(job.Source) > MaxSourceBytes || len(job.Stdin) > MaxStdinBytes {
		return fmt.Errorf("source must be 1 byte to 64 KB and input at most 64 KB")
	}
	if job.TimeLimitMS <= 0 {
		job.TimeLimitMS = DefaultTimeMS
	}
	if job.TimeLimitMS > MaxTimeMS {
		job.TimeLimitMS = MaxTimeMS
	}
	return nil
}

func clip(s string) string {
	if len(s) > MaxOutputBytes {
		return s[:MaxOutputBytes] + "\n…output truncated"
	}
	return s
}

func post(ctx context.Context, client *http.Client, url string, headers map[string]string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("%w: status %d", ErrUnavailable, res.StatusCode)
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("%w: unreadable response", ErrUnavailable)
	}
	return nil
}

// ---------------- Piston ----------------

type piston struct {
	base, token string
	client      *http.Client
}

func (p *piston) Kind() string { return "piston" }

func (p *piston) Run(ctx context.Context, job Job) (*Result, error) {
	if err := validate(&job); err != nil {
		return nil, err
	}
	lang, file := "c++", "main.cpp"
	if job.Language == "java" {
		lang, file = "java", "Main.java"
	}
	var out struct {
		Compile *struct {
			Stdout string `json:"stdout"`
			Stderr string `json:"stderr"`
			Code   *int   `json:"code"`
		} `json:"compile"`
		Run struct {
			Stdout string  `json:"stdout"`
			Stderr string  `json:"stderr"`
			Code   *int    `json:"code"`
			Signal *string `json:"signal"`
			Status string  `json:"status"` // TO (timeout), RE, SG, XX ... on newer Piston
			WallMS int     `json:"wall_time"`
			Memory int     `json:"memory"`
		} `json:"run"`
	}
	body := map[string]any{
		"language": lang, "version": "*",
		"files":            []map[string]string{{"name": file, "content": job.Source}},
		"stdin":            job.Stdin,
		"run_timeout":      job.TimeLimitMS,
		"compile_timeout":  compileTimeoutMS,
		"run_memory_limit": DefaultMemoryKB * 1024,
	}
	if err := post(ctx, p.client, p.base+"/api/v2/execute", map[string]string{"Authorization": p.token}, body, &out); err != nil {
		return nil, err
	}
	res := &Result{Status: "ok", Stdout: clip(out.Run.Stdout), Stderr: clip(out.Run.Stderr), TimeMS: out.Run.WallMS}
	if out.Compile != nil && out.Compile.Code != nil && *out.Compile.Code != 0 {
		res.Status, res.CompileOutput, res.Stdout, res.Stderr = "compile_error", clip(out.Compile.Stderr+out.Compile.Stdout), "", ""
		return res, nil
	}
	if out.Run.Code != nil {
		res.ExitCode = *out.Run.Code
	}
	switch {
	case out.Run.Status == "TO" || (out.Run.Signal != nil && *out.Run.Signal == "SIGKILL" && out.Run.WallMS >= job.TimeLimitMS):
		res.Status = "time_limit"
	case out.Run.Signal != nil || res.ExitCode != 0:
		res.Status = "runtime_error"
	}
	return res, nil
}

// ---------------- Judge0 CE ----------------

type judge0 struct {
	base, token string
	client      *http.Client
}

func (j *judge0) Kind() string { return "judge0" }

// Judge0 CE language ids: C++ (GCC 9.2.0) and Java (OpenJDK 13).
var judge0Languages = map[string]int{"cpp": 54, "java": 62}

func (j *judge0) Run(ctx context.Context, job Job) (*Result, error) {
	if err := validate(&job); err != nil {
		return nil, err
	}
	var out struct {
		Stdout        *string `json:"stdout"`
		Stderr        *string `json:"stderr"`
		CompileOutput *string `json:"compile_output"`
		Time          *string `json:"time"`
		ExitCode      *int    `json:"exit_code"`
		Status        struct {
			ID int `json:"id"`
		} `json:"status"`
	}
	body := map[string]any{
		"source_code": job.Source, "language_id": judge0Languages[job.Language], "stdin": job.Stdin,
		"cpu_time_limit": float64(job.TimeLimitMS) / 1000, "memory_limit": DefaultMemoryKB,
	}
	if err := post(ctx, j.client, j.base+"/submissions?base64_encoded=false&wait=true", map[string]string{"X-Auth-Token": j.token}, body, &out); err != nil {
		return nil, err
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return clip(*p)
	}
	res := &Result{Status: "ok", Stdout: str(out.Stdout), Stderr: str(out.Stderr), CompileOutput: str(out.CompileOutput)}
	if out.ExitCode != nil {
		res.ExitCode = *out.ExitCode
	}
	if out.Time != nil {
		var seconds float64
		fmt.Sscanf(*out.Time, "%g", &seconds)
		res.TimeMS = int(seconds * 1000)
	}
	// 3 accepted, 4 wrong answer (both ran fine), 5 time limit, 6 compilation error,
	// 7-12 runtime errors; memory limits surface as runtime errors (SIGSEGV/SIGKILL).
	switch id := out.Status.ID; {
	case id == 3 || id == 4:
	case id == 5:
		res.Status = "time_limit"
	case id == 6:
		res.Status = "compile_error"
	case id >= 7 && id <= 12:
		res.Status = "runtime_error"
	default:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, id)
	}
	return res, nil
}
