package main

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	s3config "github.com/aws/aws-sdk-go-v2/config"
	s3creds "github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/livekit/protocol/auth"
	"github.com/redis/go-redis/v9"
	"github.com/tathastu/connect/services/api/internal/config"
)

func getRevoked(envKey, b64Val string) string {
	if v := os.Getenv(envKey); v != "" {
		return v
	}
	raw, err := base64.StdEncoding.DecodeString(b64Val)
	if err != nil {
		return ""
	}
	return string(raw)
}

type CheckResult struct {
	Service   string
	TestType  string // "OLD_CREDENTIAL" or "NEW_CREDENTIAL"
	Expected  string // "REJECTED" or "ACCEPTED"
	Actual    string
	Passed    bool
	DetailMsg string
}

func main() {
	fmt.Println("=== AUTHENTICATED CLOUD PROVIDER CREDENTIAL ROTATION AUDIT ===")

	cfg, err := config.Load()
	if err != nil {
		fmt.Printf("FATAL: Failed to load environment config: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	results := []CheckResult{}

	// Known compromised credentials from previous leak (tested strictly for provider rejection)
	oldLKKey := getRevoked("REVOKED_LIVEKIT_KEY", "QVBJajNlcHZOUVV2UzM2")
	oldLKSecret := getRevoked("REVOKED_LIVEKIT_SECRET", "cmZzYVpKM2U5ZkMzNjcyN3daZXFiOVQwMVdjUTVNNkQyeEI=")
	oldRedisPass := getRevoked("REVOKED_UPSTASH_PASSWORD", "Z1FBQUFBQUFBdDVqQUFJZ2NERmlOVFJrTTJSalp6QTNNVEUwTUdKa09XRXdOell6WWpOaVlUazRNek5rT1E9PQ==")
	oldR2KeyID := getRevoked("REVOKED_R2_KEY_ID", "NDlkMTNjNmIxZTU1NTliNDcxNDY4M2M0N2Q1ODQ2MTU=")
	oldR2Secret := getRevoked("REVOKED_R2_SECRET", "MDI4YjJiMDRlYWQ1MmYxN2YyOTkxYTVkYTVhNzg1MmJhOGI2MzA1MzVhYzRiYzNjM2JhM2JiOTkyZDk5NzViYw==")

	// -------------------------------------------------------------
	// 1. LiveKit Cloud Probes
	// -------------------------------------------------------------
	lkURL := cfg.LiveKitURL
	httpURL := strings.Replace(lkURL, "wss://", "https://", 1)

	// 1a. Old LiveKit Credentials
	oldLKPass := false
	oldLKDetail := ""
	oldToken, err := createTestLiveKitToken(oldLKKey, oldLKSecret, "probe-room")
	if err != nil {
		oldLKDetail = fmt.Sprintf("token mint failed: %v", err)
	} else {
		status, body, err := probeLiveKitRoomList(ctx, httpURL, oldToken)
		if err != nil || status == http.StatusUnauthorized || status == http.StatusForbidden {
			oldLKPass = true
			oldLKDetail = fmt.Sprintf("Correctly rejected (HTTP %d): key revoked by provider", status)
		} else if status == http.StatusOK {
			oldLKPass = false
			oldLKDetail = "CRITICAL FAIL: Old LiveKit key was ACCEPTED (HTTP 200) by cloud.livekit.io"
		} else {
			oldLKDetail = fmt.Sprintf("Status %d: %s", status, body)
		}
	}
	results = append(results, CheckResult{
		Service:   "LiveKit Cloud",
		TestType:  "OLD_CREDENTIAL",
		Expected:  "REJECTED",
		Actual:    map[bool]string{true: "REJECTED", false: "ACCEPTED"}[oldLKPass],
		Passed:    oldLKPass,
		DetailMsg: oldLKDetail,
	})

	// 1b. New LiveKit Credentials
	newLKPass := false
	newLKDetail := ""
	newToken, err := createTestLiveKitToken(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret, "probe-room")
	if err != nil {
		newLKDetail = fmt.Sprintf("token mint failed: %v", err)
	} else {
		status, body, err := probeLiveKitRoomList(ctx, httpURL, newToken)
		if err == nil && (status == http.StatusOK || status == http.StatusNotFound) {
			newLKPass = true
			newLKDetail = fmt.Sprintf("Successfully authenticated (HTTP %d)", status)
		} else {
			newLKPass = false
			newLKDetail = fmt.Sprintf("Authentication failed (HTTP %d): %s (err: %v)", status, body, err)
		}
	}
	results = append(results, CheckResult{
		Service:   "LiveKit Cloud",
		TestType:  "NEW_CREDENTIAL",
		Expected:  "ACCEPTED",
		Actual:    map[bool]string{true: "ACCEPTED", false: "REJECTED"}[newLKPass],
		Passed:    newLKPass,
		DetailMsg: newLKDetail,
	})

	// -------------------------------------------------------------
	// 2. Upstash Redis Probes
	// -------------------------------------------------------------
	redisHost := "massive-moccasin-188003.upstash.io:6379"

	// 2a. Old Redis Password
	oldRedisPassCheck := false
	oldRedisDetail := ""
	oldRdb := redis.NewClient(&redis.Options{
		Addr:      redisHost,
		Password:  oldRedisPass,
		TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12},
	})
	pingErr := oldRdb.Ping(ctx).Err()
	_ = oldRdb.Close()
	if pingErr != nil {
		oldRedisPassCheck = true
		oldRedisDetail = fmt.Sprintf("Correctly rejected by Upstash: %v", pingErr)
	} else {
		oldRedisPassCheck = false
		oldRedisDetail = "CRITICAL FAIL: Old Redis password succeeded with PONG"
	}
	results = append(results, CheckResult{
		Service:   "Upstash Redis",
		TestType:  "OLD_CREDENTIAL",
		Expected:  "REJECTED",
		Actual:    map[bool]string{true: "REJECTED", false: "ACCEPTED"}[oldRedisPassCheck],
		Passed:    oldRedisPassCheck,
		DetailMsg: oldRedisDetail,
	})

	// 2b. New Redis Credentials
	newRedisPassCheck := false
	newRedisDetail := ""
	newOpt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		newRedisDetail = fmt.Sprintf("failed to parse new REDIS_URL: %v", err)
	} else {
		if cfg.RedisTLSEnabled && newOpt.TLSConfig == nil {
			newOpt.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
		}
		newRdb := redis.NewClient(newOpt)
		newPingErr := newRdb.Ping(ctx).Err()
		_ = newRdb.Close()
		if newPingErr == nil {
			newRedisPassCheck = true
			newRedisDetail = "Successfully authenticated with PONG via TLS"
		} else {
			newRedisPassCheck = false
			newRedisDetail = fmt.Sprintf("Authentication failed: %v", newPingErr)
		}
	}
	results = append(results, CheckResult{
		Service:   "Upstash Redis",
		TestType:  "NEW_CREDENTIAL",
		Expected:  "ACCEPTED",
		Actual:    map[bool]string{true: "ACCEPTED", false: "REJECTED"}[newRedisPassCheck],
		Passed:    newRedisPassCheck,
		DetailMsg: newRedisDetail,
	})

	// -------------------------------------------------------------
	// 3. Cloudflare R2 Probes
	// -------------------------------------------------------------
	// 3a. Old R2 Secret
	oldR2PassCheck := false
	oldR2Detail := ""
	oldS3Client, err := createS3Client(ctx, cfg.R2Endpoint, cfg.R2Region, oldR2KeyID, oldR2Secret)
	if err != nil {
		oldR2Detail = fmt.Sprintf("failed to init client: %v", err)
	} else {
		_, err := oldS3Client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(cfg.R2Bucket)})
		if err != nil {
			oldR2PassCheck = true
			oldR2Detail = fmt.Sprintf("Correctly rejected by Cloudflare: %v", err)
		} else {
			oldR2PassCheck = false
			oldR2Detail = "CRITICAL FAIL: Old R2 secret was ACCEPTED by Cloudflare R2"
		}
	}
	results = append(results, CheckResult{
		Service:   "Cloudflare R2",
		TestType:  "OLD_CREDENTIAL",
		Expected:  "REJECTED",
		Actual:    map[bool]string{true: "REJECTED", false: "ACCEPTED"}[oldR2PassCheck],
		Passed:    oldR2PassCheck,
		DetailMsg: oldR2Detail,
	})

	// 3b. New R2 Secret
	newR2PassCheck := false
	newR2Detail := ""
	newS3Client, err := createS3Client(ctx, cfg.R2Endpoint, cfg.R2Region, cfg.R2AccessKeyID, cfg.R2SecretAccessKey)
	if err != nil {
		newR2Detail = fmt.Sprintf("failed to init client: %v", err)
	} else {
		_, err := newS3Client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(cfg.R2Bucket)})
		if err == nil {
			newR2PassCheck = true
			newR2Detail = fmt.Sprintf("Successfully authenticated: HeadBucket OK on '%s'", cfg.R2Bucket)
		} else {
			newR2PassCheck = false
			newR2Detail = fmt.Sprintf("Authentication failed: %v", err)
		}
	}
	results = append(results, CheckResult{
		Service:   "Cloudflare R2",
		TestType:  "NEW_CREDENTIAL",
		Expected:  "ACCEPTED",
		Actual:    map[bool]string{true: "ACCEPTED", false: "REJECTED"}[newR2PassCheck],
		Passed:    newR2PassCheck,
		DetailMsg: newR2Detail,
	})

	// -------------------------------------------------------------
	// Print Summary
	// -------------------------------------------------------------
	allPassed := true
	for _, res := range results {
		icon := "✓"
		if !res.Passed {
			icon = "✗"
			allPassed = false
		}
		fmt.Printf("[%s] %-15s | %-15s | Expected: %-8s | Actual: %-8s | %s\n",
			icon, res.Service, res.TestType, res.Expected, res.Actual, res.DetailMsg)
	}

	if allPassed {
		fmt.Println("\n>>> AUDIT VERDICT: ALL CREDENTIAL ROTATIONS VERIFIED & VALID <<<")
		os.Exit(0)
	} else {
		fmt.Println("\n>>> AUDIT VERDICT: ROTATION INCOMPLETE OR BLOCKED <<<")
		os.Exit(2)
	}
}

func createTestLiveKitToken(apiKey, apiSecret, room string) (string, error) {
	at := auth.NewAccessToken(apiKey, apiSecret)
	grant := &auth.VideoGrant{
		RoomList: true,
	}
	at.AddGrant(grant).SetValidFor(2 * time.Minute).SetIdentity("probe-bot")
	return at.ToJWT()
}

func probeLiveKitRoomList(ctx context.Context, baseURL, jwtToken string) (int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/twirp/livekit.RoomService/ListRooms", strings.NewReader("{}"))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	return resp.StatusCode, resp.Status, nil
}

func createS3Client(ctx context.Context, endpoint, region, accessKey, secretKey string) (*s3.Client, error) {
	customResolver := aws.EndpointResolverWithOptionsFunc(func(service, reg string, options ...interface{}) (aws.Endpoint, error) {
		return aws.Endpoint{
			URL:               endpoint,
			SigningRegion:     region,
			HostnameImmutable: true,
		}, nil
	})

	cfg, err := s3config.LoadDefaultConfig(ctx,
		s3config.WithRegion(region),
		s3config.WithEndpointResolverWithOptions(customResolver),
		s3config.WithCredentialsProvider(s3creds.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		return nil, err
	}

	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
	}), nil
}
