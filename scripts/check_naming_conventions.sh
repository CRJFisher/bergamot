#!/bin/bash

# Script to check TypeScript naming conventions
# - Functions and variables: snake_case
# - Classes and interfaces: PascalCase
# - Constants: UPPER_SNAKE_CASE (optional, for true constants)
# - Files: snake_case

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

VIOLATIONS=0
VERBOSE=${1:-}

# Function to check if string is snake_case
is_snake_case() {
    [[ "$1" =~ ^[a-z][a-z0-9_]*$ ]]
}

# Function to check if string is PascalCase
is_pascal_case() {
    [[ "$1" =~ ^[A-Z][a-zA-Z0-9]*$ ]]
}

# Function to check if string is UPPER_SNAKE_CASE
is_upper_snake_case() {
    [[ "$1" =~ ^[A-Z][A-Z0-9_]*$ ]]
}

echo "🔍 Checking TypeScript naming conventions..."
echo "============================================"

# Check file names
echo -e "\n📁 Checking file names..."
while IFS= read -r file; do
    basename=$(basename "$file" .ts)
    basename=$(basename "$basename" .tsx)
    basename=$(basename "$basename" .js)
    basename=$(basename "$basename" .jsx)
    
    # Skip test files and special files
    if [[ "$basename" == *".test" ]] || [[ "$basename" == *".spec" ]] || [[ "$basename" == "index" ]]; then
        continue
    fi
    
    if ! is_snake_case "$basename"; then
        echo -e "${RED}✗${NC} File not in snake_case: $file"
        ((VIOLATIONS++))
    elif [[ "$VERBOSE" == "-v" ]]; then
        echo -e "${GREEN}✓${NC} $file"
    fi
done < <(find vscode/src browser-extension/src -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | grep -v node_modules | grep -v ".test.ts")

# Check function declarations
echo -e "\n📝 Checking function declarations..."
while IFS= read -r match; do
    file=$(echo "$match" | cut -d: -f1)
    line_num=$(echo "$match" | cut -d: -f2)
    line=$(echo "$match" | cut -d: -f3-)
    
    # Extract function name
    if [[ "$line" =~ (async[[:space:]]+)?function[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*) ]]; then
        func_name="${BASH_REMATCH[2]}"
        
        # Skip test functions and lifecycle hooks
        if [[ "$func_name" == "beforeEach" ]] || [[ "$func_name" == "afterEach" ]] || 
           [[ "$func_name" == "beforeAll" ]] || [[ "$func_name" == "afterAll" ]] ||
           [[ "$func_name" == "describe" ]] || [[ "$func_name" == "it" ]] ||
           [[ "$func_name" == "test" ]] || [[ "$func_name" == "expect" ]]; then
            continue
        fi
        
        if ! is_snake_case "$func_name"; then
            echo -e "${RED}✗${NC} Function not in snake_case: $func_name at $file:$line_num"
            ((VIOLATIONS++))
        elif [[ "$VERBOSE" == "-v" ]]; then
            echo -e "${GREEN}✓${NC} $func_name at $file:$line_num"
        fi
    fi
done < <(find vscode/src browser-extension/src -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | xargs grep -n -E "(async[[:space:]]+)?function[[:space:]]+[a-zA-Z_]" 2>/dev/null | grep -v ".test.ts" | grep -v "node_modules")

# Check exported const/let/var declarations
echo -e "\n📦 Checking exported variables..."
while IFS= read -r match; do
    file=$(echo "$match" | cut -d: -f1)
    line_num=$(echo "$match" | cut -d: -f2)
    line=$(echo "$match" | cut -d: -f3-)
    
    # Extract variable name
    if [[ "$line" =~ export[[:space:]]+(const|let|var)[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*) ]]; then
        var_name="${BASH_REMATCH[2]}"
        
        # Check if it's a class or schema (should be PascalCase)
        if [[ "$var_name" == *"Schema" ]] || [[ "$var_name" == *"Spec" ]] || 
           [[ "$var_name" == *"Error" ]] || [[ "$var_name" == *"Exception" ]]; then
            if ! is_pascal_case "$var_name"; then
                echo -e "${RED}✗${NC} Schema/Spec/Error not in PascalCase: $var_name at $file:$line_num"
                ((VIOLATIONS++))
            fi
        # Check if it's a true constant (all caps)
        elif [[ "$line" =~ \"[^\"]+\" ]] || [[ "$line" =~ [0-9]+ ]] || [[ "$line" =~ true|false ]]; then
            # It's a literal constant, could be UPPER_SNAKE_CASE or snake_case
            if ! is_snake_case "$var_name" && ! is_upper_snake_case "$var_name"; then
                echo -e "${YELLOW}⚠${NC} Constant could be UPPER_SNAKE_CASE: $var_name at $file:$line_num"
            fi
        else
            # Regular variable should be snake_case
            if ! is_snake_case "$var_name"; then
                echo -e "${RED}✗${NC} Variable not in snake_case: $var_name at $file:$line_num"
                ((VIOLATIONS++))
            elif [[ "$VERBOSE" == "-v" ]]; then
                echo -e "${GREEN}✓${NC} $var_name at $file:$line_num"
            fi
        fi
    fi
done < <(find vscode/src browser-extension/src -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | xargs grep -n -E "export[[:space:]]+(const|let|var)[[:space:]]" 2>/dev/null | grep -v ".test.ts" | grep -v "node_modules")

# Check class declarations
echo -e "\n🏛️ Checking class declarations..."
while IFS= read -r match; do
    file=$(echo "$match" | cut -d: -f1)
    line_num=$(echo "$match" | cut -d: -f2)
    line=$(echo "$match" | cut -d: -f3-)
    
    # Extract class name
    if [[ "$line" =~ (export[[:space:]]+)?class[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*) ]]; then
        class_name="${BASH_REMATCH[2]}"
        
        if ! is_pascal_case "$class_name"; then
            echo -e "${RED}✗${NC} Class not in PascalCase: $class_name at $file:$line_num"
            ((VIOLATIONS++))
        elif [[ "$VERBOSE" == "-v" ]]; then
            echo -e "${GREEN}✓${NC} $class_name at $file:$line_num"
        fi
    fi
done < <(find vscode/src browser-extension/src -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | xargs grep -n -E "(export[[:space:]]+)?class[[:space:]]+" 2>/dev/null | grep -v ".test.ts" | grep -v "node_modules")

# Check interface declarations
echo -e "\n🔗 Checking interface declarations..."
while IFS= read -r match; do
    file=$(echo "$match" | cut -d: -f1)
    line_num=$(echo "$match" | cut -d: -f2)
    line=$(echo "$match" | cut -d: -f3-)
    
    # Extract interface name
    if [[ "$line" =~ (export[[:space:]]+)?interface[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*) ]]; then
        interface_name="${BASH_REMATCH[2]}"
        
        if ! is_pascal_case "$interface_name"; then
            echo -e "${RED}✗${NC} Interface not in PascalCase: $interface_name at $file:$line_num"
            ((VIOLATIONS++))
        elif [[ "$VERBOSE" == "-v" ]]; then
            echo -e "${GREEN}✓${NC} $interface_name at $file:$line_num"
        fi
    fi
done < <(find vscode/src browser-extension/src -name "*.ts" -o -name "*.tsx" 2>/dev/null | xargs grep -n -E "(export[[:space:]]+)?interface[[:space:]]+" 2>/dev/null | grep -v ".test.ts" | grep -v "node_modules")

# Check type declarations
echo -e "\n🎯 Checking type declarations..."
while IFS= read -r match; do
    file=$(echo "$match" | cut -d: -f1)
    line_num=$(echo "$match" | cut -d: -f2)
    line=$(echo "$match" | cut -d: -f3-)
    
    # Extract type name
    if [[ "$line" =~ (export[[:space:]]+)?type[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*) ]]; then
        type_name="${BASH_REMATCH[2]}"
        
        if ! is_pascal_case "$type_name"; then
            echo -e "${RED}✗${NC} Type not in PascalCase: $type_name at $file:$line_num"
            ((VIOLATIONS++))
        elif [[ "$VERBOSE" == "-v" ]]; then
            echo -e "${GREEN}✓${NC} $type_name at $file:$line_num"
        fi
    fi
done < <(find vscode/src browser-extension/src -name "*.ts" -o -name "*.tsx" 2>/dev/null | xargs grep -n -E "(export[[:space:]]+)?type[[:space:]]+" 2>/dev/null | grep -v ".test.ts" | grep -v "node_modules" | grep -v "=[[:space:]]*{")

# Summary
echo -e "\n============================================"
if [ $VIOLATIONS -eq 0 ]; then
    echo -e "${GREEN}✅ All naming conventions are correct!${NC}"
    exit 0
else
    echo -e "${RED}❌ Found $VIOLATIONS naming convention violations${NC}"
    echo -e "${YELLOW}Run with -v flag for verbose output${NC}"
    exit 1
fi