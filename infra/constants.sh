#!/usr/bin/env bash
# Sourced by Docker, Compose, and Kubernetes scripts to prevent port conflicts and name typos.

export NETWORK="rateforge-net"
export GATEWAY_PORT="3000"
export LIMITER_PORT="3001"
export REDIS_PORT="6379"
export DASHBOARD_PORT="4000"
