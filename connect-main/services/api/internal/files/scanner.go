package files

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

var (
	ErrScannerUnavailable = errors.New("malware scanner unavailable")
)

type Scanner interface {
	Scan(ctx context.Context, file *MeetingFile, data []byte) (status ScanStatus, result string, err error)
}

// ProductionScanner orchestrates deep heuristic inspection and optional network daemon scanning (ClamAV).
type ProductionScanner struct {
	clamavEnabled bool
	clamavAddr    string
	timeout       time.Duration
}

func NewProductionScanner(clamavEnabled bool, clamavHost string, clamavPort int) *ProductionScanner {
	addr := ""
	if clamavEnabled {
		if clamavPort <= 0 {
			clamavPort = 3310
		}
		if clamavHost == "" {
			clamavHost = "localhost"
		}
		addr = fmt.Sprintf("%s:%d", clamavHost, clamavPort)
	}

	return &ProductionScanner{
		clamavEnabled: clamavEnabled,
		clamavAddr:    addr,
		timeout:       5 * time.Second, // Bounded scanning timeout
	}
}

// NewHeuristicScanner returns a standalone scanner running heuristic & signature inspection.
func NewHeuristicScanner() *ProductionScanner {
	return NewProductionScanner(false, "", 0)
}

func (s *ProductionScanner) Scan(ctx context.Context, file *MeetingFile, data []byte) (ScanStatus, string, error) {
	if len(data) == 0 {
		return ScanStatusRejected, "Empty payload rejected", nil
	}

	// 1. Mandatory Heuristic & Signature Inspection
	heuristicStatus, heuristicMsg := runHeuristicInspection(file, data)
	if heuristicStatus == ScanStatusRejected {
		return ScanStatusRejected, heuristicMsg, nil
	}

	// 2. ClamAV Daemon Scanning (if enabled)
	if s.clamavEnabled {
		clamStatus, clamMsg, err := s.scanWithClamAV(ctx, data)
		if err != nil {
			// Fail-closed security rule: Never promote unscanned files to AVAILABLE
			return ScanStatusQuarantined, fmt.Sprintf("Quarantined: scanner error (%v)", err), ErrScannerUnavailable
		}
		if clamStatus == ScanStatusRejected {
			return ScanStatusRejected, clamMsg, nil
		}
	}

	return ScanStatusAvailable, "Clean: File passed signature heuristics and security inspection", nil
}

// runHeuristicInspection inspects binary magic bytes, exploit patterns, and EICAR strings.
func runHeuristicInspection(file *MeetingFile, data []byte) (ScanStatus, string) {
	// Standard EICAR Anti-Virus Test String detection
	if bytes.Contains(data, []byte("EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")) {
		return ScanStatusRejected, "Rejected: EICAR test malware signature detected"
	}

	// Windows PE Executable (MZ)
	if bytes.HasPrefix(data, []byte("MZ")) {
		return ScanStatusRejected, "Rejected: Executable PE binary signature detected"
	}

	// Linux ELF Executable
	if bytes.HasPrefix(data, []byte("\x7fELF")) {
		return ScanStatusRejected, "Rejected: Linux ELF executable signature detected"
	}

	// Mach-O Executables (32-bit & 64-bit, big & little endian)
	if len(data) >= 4 {
		magic := data[:4]
		if bytes.Equal(magic, []byte{0xfe, 0xed, 0xfa, 0xce}) ||
			bytes.Equal(magic, []byte{0xce, 0xfa, 0xed, 0xfe}) ||
			bytes.Equal(magic, []byte{0xfe, 0xed, 0xfa, 0xcf}) ||
			bytes.Equal(magic, []byte{0xcf, 0xfa, 0xed, 0xfe}) {
			return ScanStatusRejected, "Rejected: Mach-O binary signature detected"
		}
	}

	// Text-specific payload analysis
	if file.FileType == "txt" {
		lowerContent := strings.ToLower(string(data))
		if strings.Contains(lowerContent, "<script") ||
			strings.Contains(lowerContent, "javascript:") ||
			strings.Contains(lowerContent, "vbscript:") {
			return ScanStatusRejected, "Rejected: Cross-site scripting payload detected in text file"
		}
		if bytes.HasPrefix(data, []byte("#!/bin/sh")) ||
			bytes.HasPrefix(data, []byte("#!/bin/bash")) ||
			bytes.HasPrefix(data, []byte("#!/usr/bin/env")) {
			return ScanStatusRejected, "Rejected: Shell script executable detected"
		}
	}

	// PDF Exploit Heuristics (inspect for active launch actions or JS streams)
	if file.FileType == "pdf" {
		lowerData := strings.ToLower(string(data[:min(len(data), 65536)]))
		if strings.Contains(lowerData, "/launch") && strings.Contains(lowerData, "/action") {
			return ScanStatusRejected, "Rejected: PDF embedded launch action detected"
		}
	}

	// Validate format consistency
	verified, err := ValidateFileFormat(file.OriginalFilename, data)
	if err != nil || verified.FileType != file.FileType {
		return ScanStatusRejected, "Rejected: File signature mismatch during security inspection"
	}

	return ScanStatusAvailable, "Heuristics passed"
}

// scanWithClamAV communicates with clamd daemon via nINSTREAM command.
func (s *ProductionScanner) scanWithClamAV(ctx context.Context, data []byte) (ScanStatus, string, error) {
	d := net.Dialer{Timeout: s.timeout}
	conn, err := d.DialContext(ctx, "tcp", s.clamavAddr)
	if err != nil {
		return ScanStatusQuarantined, "", fmt.Errorf("clamd connect failed: %w", err)
	}
	defer conn.Close()

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(s.timeout))
	}

	// Send clamd nINSTREAM command
	if _, err := conn.Write([]byte("zINSTREAM\x00")); err != nil {
		return ScanStatusQuarantined, "", fmt.Errorf("clamd write command failed: %w", err)
	}

	// Stream chunk by chunk (up to 32KB per chunk)
	reader := bytes.NewReader(data)
	buf := make([]byte, 32768)
	for {
		n, rErr := reader.Read(buf)
		if n > 0 && n <= len(buf) {
			var length [4]byte
			// #nosec G115 - n is strictly bounded by len(buf)=32768
			binary.BigEndian.PutUint32(length[:], uint32(n))
			if _, err := conn.Write(length[:]); err != nil {
				return ScanStatusQuarantined, "", fmt.Errorf("clamd write chunk size failed: %w", err)
			}
			if _, err := conn.Write(buf[:n]); err != nil {
				return ScanStatusQuarantined, "", fmt.Errorf("clamd write chunk data failed: %w", err)
			}
		}
		if rErr != nil {
			if errors.Is(rErr, io.EOF) {
				break
			}
			return ScanStatusQuarantined, "", fmt.Errorf("read buffer failed: %w", rErr)
		}
	}

	// Zero-length chunk signals end of stream
	if _, err := conn.Write([]byte{0, 0, 0, 0}); err != nil {
		return ScanStatusQuarantined, "", fmt.Errorf("clamd write EOF chunk failed: %w", err)
	}

	// Read response
	respBuf := make([]byte, 1024)
	n, err := conn.Read(respBuf)
	if err != nil {
		return ScanStatusQuarantined, "", fmt.Errorf("clamd read response failed: %w", err)
	}

	response := strings.TrimSpace(string(respBuf[:n]))
	if strings.HasSuffix(response, "OK") {
		return ScanStatusAvailable, "ClamAV: OK", nil
	}
	if strings.Contains(response, "FOUND") {
		return ScanStatusRejected, fmt.Sprintf("Rejected: Threat detected by ClamAV (%s)", response), nil
	}

	return ScanStatusQuarantined, fmt.Sprintf("Unexpected ClamAV response: %s", response), errors.New("clamd unexpected response")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
