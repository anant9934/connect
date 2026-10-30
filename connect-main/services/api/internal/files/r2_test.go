package files_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tathastu/connect/services/api/internal/files"
)

func TestR2_LiveOperations(t *testing.T) {
	endpoint := os.Getenv("R2_ENDPOINT")
	bucket := os.Getenv("R2_BUCKET")
	accessKey := os.Getenv("R2_ACCESS_KEY_ID")
	secretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	region := os.Getenv("R2_REGION")

	if endpoint == "" || bucket == "" || accessKey == "" || secretKey == "" {
		t.Skip("Skipping live R2 integration test: R2 credentials not configured in environment")
	}

	if region == "" {
		region = "auto"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// 1. Initialize R2 Storage Provider
	prov, err := files.NewR2StorageProvider(ctx, files.R2StorageConfig{
		Endpoint:        endpoint,
		Bucket:          bucket,
		AccessKeyID:     accessKey,
		SecretAccessKey: secretKey,
		Region:          region,
	})
	require.NoError(t, err, "Failed to initialize R2 storage provider")
	require.NotNil(t, prov)

	// 2. Upload (Store) test object
	testKey := "tests/r2_verify_" + time.Now().Format("20060102150405.000") + ".txt"
	testPayload := []byte("Tathastu Connect Cloudflare R2 verified at " + time.Now().UTC().Format(time.RFC3339))

	err = prov.Store(ctx, testKey, testPayload)
	require.NoError(t, err, "Failed to store test object in R2 bucket")

	// 3. Download (Get) test object and verify content integrity
	retrievedData, err := prov.Get(ctx, testKey)
	require.NoError(t, err, "Failed to get test object from R2 bucket")
	assert.Equal(t, testPayload, retrievedData, "Retrieved data does not match uploaded payload")

	// 4. Delete test object
	err = prov.Delete(ctx, testKey)
	require.NoError(t, err, "Failed to delete test object from R2 bucket")

	// 5. Verify object no longer exists
	_, err = prov.Get(ctx, testKey)
	assert.ErrorIs(t, err, files.ErrFileNotFound, "Expected ErrFileNotFound after deleting object")

	// 6. Verify idempotent deletion (deleting non-existent key succeeds)
	err = prov.Delete(ctx, testKey)
	assert.NoError(t, err, "Expected delete of non-existent key to be idempotent")

	// 7. Verify size boundary enforcement
	oversized := make([]byte, files.MaxFileSizeBytes+100)
	err = prov.Store(ctx, "tests/oversized.bin", oversized)
	assert.ErrorIs(t, err, files.ErrFileTooLarge, "Expected ErrFileTooLarge for payload exceeding 25MB limit")
}
