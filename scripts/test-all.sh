#!/bin/bash

# PKM Assistant - Comprehensive Test Suite
# Tests all components before publishing

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${YELLOW}[→]${NC} $1"
}

print_section() {
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================${NC}"
}

# Get the root directory
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Track test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Function to run tests
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    print_info "Running: $test_name"
    
    if eval "$test_command" > /dev/null 2>&1; then
        print_status "$test_name passed"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        print_error "$test_name failed"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

print_section "PKM Assistant - Pre-Publishing Test Suite"

# Check prerequisites
print_section "Checking Prerequisites"

if ! command_exists node; then
    print_error "Node.js is not installed"
    exit 1
fi
print_status "Node.js $(node --version)"

if ! command_exists npm; then
    print_error "npm is not installed"
    exit 1
fi
print_status "npm $(npm --version)"

if ! command_exists python3; then
    print_error "Python 3 is not installed"
    exit 1
fi
print_status "Python $(python3 --version)"

# Install dependencies
print_section "Installing Dependencies"

print_info "Installing root dependencies..."
npm install --quiet || { print_error "Failed to install root dependencies"; exit 1; }
print_status "Root dependencies installed"

print_info "Installing VS Code extension dependencies..."
cd vscode && npm install --quiet || { print_error "Failed to install VS Code dependencies"; exit 1; }
print_status "VS Code dependencies installed"
cd ..

print_info "Installing browser extension dependencies..."
cd browser && npm install --quiet || { print_error "Failed to install browser dependencies"; exit 1; }
print_status "Browser dependencies installed"
cd ..

# Run VS Code Extension Tests
print_section "Testing VS Code Extension"

cd vscode

# TypeScript compilation
run_test "VS Code TypeScript compilation" "npm run compile"

# Run unit tests
if [ -f "jest.config.js" ]; then
    run_test "VS Code unit tests" "npm test"
else
    print_info "No VS Code unit tests configured - skipping"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

# Check for linting
if npm run --silent 2>/dev/null | grep -q "lint"; then
    run_test "VS Code linting" "npm run lint"
else
    print_info "No linting configured for VS Code extension - skipping"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

cd ..

# Run Browser Extension Tests
print_section "Testing Browser Extension"

cd browser

# Build browser extension
run_test "Browser extension build" "npm run build"

# Run unit tests
if [ -f "jest.config.cjs" ]; then
    run_test "Browser extension unit tests" "npm test"
else
    print_info "No browser unit tests configured - skipping"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

cd ..

# Test Native Messaging Host
print_section "Testing Native Messaging Host"

if [ -f "native-host/test_native_host.py" ]; then
    run_test "Native host Python tests" "python3 native-host/test_native_host.py"
else
    print_info "Native host tests not found - skipping"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

# Test Procedural Memory
print_section "Testing Procedural Memory"

cd vscode
if [ -f "src/memory/__tests__/procedural_memory_store.test.ts" ]; then
    run_test "Procedural memory tests" "npx jest src/memory/__tests__/procedural_memory_store.test.ts"
else
    print_info "Procedural memory tests not found - skipping"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

if [ -f "src/workflow/__tests__/enhanced_webpage_filter.test.ts" ]; then
    run_test "Enhanced filter tests" "npx jest src/workflow/__tests__/enhanced_webpage_filter.test.ts"
else
    print_info "Enhanced filter tests not found - skipping"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi
cd ..

# Test Packaging
print_section "Testing Package Creation"

# Test VS Code extension packaging
run_test "VS Code extension packaging" "cd vscode && npm run package"

# Test browser extension packaging
run_test "Chrome extension packaging" "cd browser && npm run build && cd chrome && zip -qr ../test-chrome.zip . && rm ../test-chrome.zip"
run_test "Firefox extension packaging" "cd browser && npm run build && cd firefox && zip -qr ../test-firefox.zip . && rm ../test-firefox.zip"

# Validate manifest files
print_section "Validating Manifest Files"

# Check VS Code manifest
if [ -f "vscode/package.json" ]; then
    run_test "VS Code manifest validation" "node -e \"require('./vscode/package.json')\""
else
    print_error "VS Code package.json not found"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Check Chrome manifest
if [ -f "browser/chrome/manifest.json" ]; then
    run_test "Chrome manifest validation" "node -e \"require('./browser/chrome/manifest.json')\""
else
    print_error "Chrome manifest.json not found"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Check Firefox manifest
if [ -f "browser/firefox/manifest.json" ]; then
    run_test "Firefox manifest validation" "node -e \"require('./browser/firefox/manifest.json')\""
else
    print_error "Firefox manifest.json not found"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Security Checks
print_section "Security Checks"

# Check for exposed API keys
print_info "Checking for exposed API keys..."
if grep -r "OPENAI_API_KEY\s*=\s*['\"]sk-" --include="*.ts" --include="*.js" --include="*.json" . 2>/dev/null; then
    print_error "Found exposed API keys!"
    FAILED_TESTS=$((FAILED_TESTS + 1))
else
    print_status "No exposed API keys found"
    PASSED_TESTS=$((PASSED_TESTS + 1))
fi

# Check for console.log statements in production code
print_info "Checking for debug console.log statements..."
LOG_COUNT=$(grep -r "console\.log" --include="*.ts" --include="*.js" vscode/src browser/src 2>/dev/null | wc -l)
if [ "$LOG_COUNT" -gt 50 ]; then
    print_error "Found $LOG_COUNT console.log statements (threshold: 50)"
    print_info "Consider removing debug logging before publishing"
fi

# Final Report
print_section "Test Results Summary"

echo ""
echo "Total Tests:    $TOTAL_TESTS"
echo -e "Passed:         ${GREEN}$PASSED_TESTS${NC}"
if [ "$FAILED_TESTS" -gt 0 ]; then
    echo -e "Failed:         ${RED}$FAILED_TESTS${NC}"
else
    echo -e "Failed:         $FAILED_TESTS"
fi
if [ "$SKIPPED_TESTS" -gt 0 ]; then
    echo -e "Skipped:        ${YELLOW}$SKIPPED_TESTS${NC}"
fi

echo ""
if [ "$FAILED_TESTS" -eq 0 ]; then
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}✅ All tests passed! Ready for publishing.${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run: npm run package:all"
    echo "2. Test the packaged extensions manually"
    echo "3. Publish to respective stores"
    exit 0
else
    echo -e "${RED}================================================${NC}"
    echo -e "${RED}❌ Some tests failed. Please fix before publishing.${NC}"
    echo -e "${RED}================================================${NC}"
    exit 1
fi