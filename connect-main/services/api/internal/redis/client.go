package redis

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/tathastu/connect/services/api/internal/config"
)

// Client wraps a go-redis client.
type Client struct {
	Rdb *redis.Client
}

// Connect initializes a Redis connection with TLS support and timeout checks.
func Connect(ctx context.Context, cfg *config.Config) (*Client, error) {
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse redis url: %w", err)
	}

	if cfg.RedisTLSEnabled || opts.TLSConfig != nil {
		if opts.TLSConfig == nil {
			opts.TLSConfig = &tls.Config{
				MinVersion: tls.VersionTLS12,
			}
		} else {
			opts.TLSConfig.MinVersion = tls.VersionTLS12
		}
		if opts.TLSConfig.ServerName == "" {
			host, _, splitErr := net.SplitHostPort(opts.Addr)
			if splitErr == nil {
				opts.TLSConfig.ServerName = host
			} else {
				opts.TLSConfig.ServerName = opts.Addr
			}
		}
	}

	rdb := redis.NewClient(opts)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}

	return &Client{Rdb: rdb}, nil
}

// Ping checks Redis connectivity for readiness probes.
func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.Rdb == nil {
		return fmt.Errorf("redis client not initialized")
	}
	return c.Rdb.Ping(ctx).Err()
}

// Close gracefully terminates connection to Redis.
func (c *Client) Close() error {
	if c != nil && c.Rdb != nil {
		return c.Rdb.Close()
	}
	return nil
}
