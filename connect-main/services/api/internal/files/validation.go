package files

import (
	"archive/zip"
	"bytes"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	safeFilenameRegex = regexp.MustCompile(`[^a-zA-Z0-9._ -]`)
)

type ValidatedFormat struct {
	FileType string
	MimeType string
}

// SanitizeFilename safely cleans an incoming user filename.
func SanitizeFilename(raw string) (string, error) {
	// Base clean: strip directories
	clean := filepath.Base(filepath.Clean(raw))
	clean = strings.TrimSpace(clean)
	clean = strings.ReplaceAll(clean, "\x00", "")

	if clean == "" || clean == "." || clean == "/" || clean == "\\" {
		return "", ErrInvalidFilename
	}

	// Remove any remaining path traversal attempts
	for strings.Contains(clean, "..") {
		clean = strings.ReplaceAll(clean, "..", "")
	}

	// Filter characters
	clean = safeFilenameRegex.ReplaceAllString(clean, "_")
	if len(clean) > 100 {
		ext := filepath.Ext(clean)
		base := clean[:100-len(ext)]
		clean = base + ext
	}

	if len(clean) < 3 {
		return "", ErrInvalidFilename
	}

	return clean, nil
}

// ValidateFileFormat inspects the magic bytes and internal structure of file data.
func ValidateFileFormat(filename string, data []byte) (*ValidatedFormat, error) {
	if len(data) == 0 {
		return nil, errors.New("empty file data")
	}

	ext := strings.ToLower(filepath.Ext(filename))

	// 1. PDF
	if ext == ".pdf" {
		if bytes.HasPrefix(data, []byte("%PDF-")) {
			return &ValidatedFormat{
				FileType: "pdf",
				MimeType: "application/pdf",
			}, nil
		}
		return nil, ErrInvalidFileType
	}

	// 2. PNG
	if ext == ".png" {
		pngMagic := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
		if bytes.HasPrefix(data, pngMagic) {
			return &ValidatedFormat{
				FileType: "png",
				MimeType: "image/png",
			}, nil
		}
		return nil, ErrInvalidFileType
	}

	// 3. JPEG
	if ext == ".jpg" || ext == ".jpeg" {
		if len(data) > 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
			return &ValidatedFormat{
				FileType: "jpeg",
				MimeType: "image/jpeg",
			}, nil
		}
		return nil, ErrInvalidFileType
	}

	// 4. WebP
	if ext == ".webp" {
		if len(data) >= 12 &&
			string(data[0:4]) == "RIFF" &&
			string(data[8:12]) == "WEBP" {
			return &ValidatedFormat{
				FileType: "webp",
				MimeType: "image/webp",
			}, nil
		}
		return nil, ErrInvalidFileType
	}

	// 5. TXT
	if ext == ".txt" {
		if !utf8.Valid(data) {
			return nil, ErrInvalidFileType
		}
		// Ensure it does not contain binary control characters
		for _, b := range data {
			if b < 0x20 && b != '\n' && b != '\r' && b != '\t' {
				return nil, ErrInvalidFileType
			}
		}
		return &ValidatedFormat{
			FileType: "txt",
			MimeType: "text/plain",
		}, nil
	}

	// 6. PPTX (OpenXML Presentation)
	if ext == ".pptx" {
		zipMagic := []byte{0x50, 0x4B, 0x03, 0x04}
		if !bytes.HasPrefix(data, zipMagic) {
			return nil, ErrInvalidFileType
		}

		// Safely inspect zip archive without full extraction
		zipReader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, ErrInvalidFileType
		}

		if len(zipReader.File) > 1000 {
			return nil, errors.New("pptx archive exceeds maximum entry count")
		}

		var totalUncompressedSize uint64
		var hasContentTypes, hasPresentation bool

		for _, f := range zipReader.File {
			totalUncompressedSize += f.UncompressedSize64
			// Zip bomb protection: max 150 MB uncompressed
			if totalUncompressedSize > 150*1024*1024 {
				return nil, errors.New("pptx uncompressed payload exceeds safety threshold")
			}
			if f.Name == "[Content_Types].xml" {
				hasContentTypes = true
			}
			if strings.HasPrefix(f.Name, "ppt/") {
				hasPresentation = true
			}
		}

		if !hasContentTypes && !hasPresentation {
			return nil, ErrInvalidFileType
		}

		return &ValidatedFormat{
			FileType: "pptx",
			MimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		}, nil
	}

	return nil, ErrInvalidFileType
}
