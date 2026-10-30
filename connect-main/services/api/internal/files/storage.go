package files

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type StorageProvider interface {
	Store(ctx context.Context, key string, data []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

// LocalStorageProvider persists files to an isolated filesystem directory outside web roots.
type LocalStorageProvider struct {
	baseDir string
	mu      sync.RWMutex
}

func NewLocalStorageProvider(baseDir string) (*LocalStorageProvider, error) {
	absDir, err := filepath.Abs(baseDir)
	if err != nil {
		return nil, fmt.Errorf("invalid storage path: %w", err)
	}
	if err := os.MkdirAll(absDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to initialize storage directory: %w", err)
	}
	return &LocalStorageProvider{baseDir: absDir}, nil
}

func (l *LocalStorageProvider) Store(ctx context.Context, key string, data []byte) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	targetPath := filepath.Join(l.baseDir, filepath.Clean(key))
	// Ensure target path does not escape baseDir
	rel, err := filepath.Rel(l.baseDir, targetPath)
	if err != nil || stringsHasPrefixDotDot(rel) {
		return ErrStorageFailure
	}

	// #nosec G703 - directory creation validated by filepath.Rel containment
	if err := os.MkdirAll(filepath.Dir(targetPath), 0700); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// #nosec G304,G703 - targetPath confirmed within baseDir via filepath.Rel
	return os.WriteFile(targetPath, data, 0600)
}

func (l *LocalStorageProvider) Get(ctx context.Context, key string) ([]byte, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()

	targetPath := filepath.Join(l.baseDir, filepath.Clean(key))
	rel, err := filepath.Rel(l.baseDir, targetPath)
	if err != nil || stringsHasPrefixDotDot(rel) {
		return nil, ErrStorageFailure
	}

	// #nosec G304,G703 - targetPath confirmed within baseDir via filepath.Rel
	data, err := os.ReadFile(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrFileNotFound
		}
		return nil, fmt.Errorf("failed to read file: %w", err)
	}
	return data, nil
}

func (l *LocalStorageProvider) Delete(ctx context.Context, key string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	targetPath := filepath.Join(l.baseDir, filepath.Clean(key))
	rel, err := filepath.Rel(l.baseDir, targetPath)
	if err != nil || stringsHasPrefixDotDot(rel) {
		return ErrStorageFailure
	}

	// #nosec G703 - targetPath confirmed within baseDir via filepath.Rel
	err = os.Remove(targetPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete file: %w", err)
	}
	return nil
}

// MemoryStorageProvider stores files in memory for fast testing and ephemeral mode.
type MemoryStorageProvider struct {
	mu    sync.RWMutex
	store map[string][]byte
}

func NewMemoryStorageProvider() *MemoryStorageProvider {
	return &MemoryStorageProvider{
		store: make(map[string][]byte),
	}
}

func (m *MemoryStorageProvider) Store(ctx context.Context, key string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	buf := make([]byte, len(data))
	copy(buf, data)
	m.store[key] = buf
	return nil
}

func (m *MemoryStorageProvider) Get(ctx context.Context, key string) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	data, exists := m.store[key]
	if !exists {
		return nil, ErrFileNotFound
	}
	buf := make([]byte, len(data))
	copy(buf, data)
	return buf, nil
}

func (m *MemoryStorageProvider) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.store, key)
	return nil
}

func stringsHasPrefixDotDot(rel string) bool {
	return rel == ".." || len(rel) >= 3 && rel[0:3] == ".."+string(filepath.Separator)
}

// R2StorageConfig specifies credentials and endpoint configuration for Cloudflare R2 / S3.
type R2StorageConfig struct {
	Endpoint        string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	Region          string
}

// R2StorageProvider implements StorageProvider against Cloudflare R2 via AWS SDK for Go v2.
type R2StorageProvider struct {
	client *s3.Client
	bucket string
}

func NewR2StorageProvider(ctx context.Context, cfg R2StorageConfig) (*R2StorageProvider, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		return nil, fmt.Errorf("missing required R2 configuration (endpoint, bucket, accessKeyId, secretAccessKey)")
	}

	region := cfg.Region
	if region == "" {
		region = "auto"
	}

	r2Config, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
		awsconfig.WithRegion(region),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config for R2: %w", err)
	}

	client := s3.NewFromConfig(r2Config, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.Endpoint)
		o.UsePathStyle = true
	})

	return &R2StorageProvider{
		client: client,
		bucket: cfg.Bucket,
	}, nil
}

// Store uploads object bytes to Cloudflare R2 bucket.
func (r *R2StorageProvider) Store(ctx context.Context, key string, data []byte) error {
	if int64(len(data)) > MaxFileSizeBytes {
		return ErrFileTooLarge
	}
	cleanedKey := strings.TrimLeft(filepath.ToSlash(filepath.Clean(key)), "/")
	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(r.bucket),
		Key:           aws.String(cleanedKey),
		Body:          bytes.NewReader(data),
		ContentLength: aws.Int64(int64(len(data))),
	})
	if err != nil {
		return fmt.Errorf("r2 put object failed: %w", err)
	}
	return nil
}

// Get streams object bytes from Cloudflare R2 bucket with memory bounds.
func (r *R2StorageProvider) Get(ctx context.Context, key string) ([]byte, error) {
	cleanedKey := strings.TrimLeft(filepath.ToSlash(filepath.Clean(key)), "/")
	resp, err := r.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(cleanedKey),
	})
	if err != nil {
		var nfe *types.NoSuchKey
		if errors.As(err, &nfe) {
			return nil, ErrFileNotFound
		}
		return nil, fmt.Errorf("r2 get object failed: %w", err)
	}
	defer resp.Body.Close()

	limitedReader := io.LimitReader(resp.Body, MaxFileSizeBytes+1024)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("r2 read object body failed: %w", err)
	}
	if int64(len(data)) > MaxFileSizeBytes {
		return nil, ErrFileTooLarge
	}
	return data, nil
}

// Delete removes an object from Cloudflare R2 idempotently.
func (r *R2StorageProvider) Delete(ctx context.Context, key string) error {
	cleanedKey := strings.TrimLeft(filepath.ToSlash(filepath.Clean(key)), "/")
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(cleanedKey),
	})
	if err != nil {
		var nfe *types.NoSuchKey
		if errors.As(err, &nfe) {
			return nil
		}
		return fmt.Errorf("r2 delete object failed: %w", err)
	}
	return nil
}
