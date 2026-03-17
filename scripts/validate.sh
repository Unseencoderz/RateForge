#!/bin/bash

# ── RateForge task validator ──────────────────────────────────────
# Run this after every agent task: bash scripts/validate.sh
# ─────────────────────────────────────────────────────────────────

set -e  # stop on first failure
PASS=0
FAIL=0

check() {
  local label=$1
  shift
  printf "  %-40s" "$label"
  if "$@" > /tmp/rf_check.log 2>&1; then
    echo "✅ PASS"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL"
    cat /tmp/rf_check.log
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "═══════════════════════════════════════════"
echo "  RateForge — Task validation"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Build dependencies first (required for composite TS) ──────
echo "▶  Building shared packages..."
check "Build @rateforge/types"   pnpm --filter @rateforge/types build
check "Build @rateforge/config"  pnpm --filter @rateforge/config build

# ── 2. Typecheck all packages ────────────────────────────────────
echo ""
echo "▶  Typechecking..."
check "Typecheck all packages"   pnpm typecheck

# ── 3. Lint ──────────────────────────────────────────────────────
echo ""
echo "▶  Linting..."
check "Lint all packages"        pnpm lint

# ── 4. Tests ─────────────────────────────────────────────────────
echo ""
echo "▶  Running tests..."
check "All test suites"          pnpm test

# ── 5. Summary ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "  ⚠️  Fix failures before assigning the next task."
  exit 1
else
  echo "  🚀  All checks passed. Safe to continue."
  exit 0
fi