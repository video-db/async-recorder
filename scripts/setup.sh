#!/bin/bash
# setup.sh - One-time setup for Async Recorder
# Usage: ./scripts/setup.sh [--api-key <KEY>] [--name <NAME>]
# If flags are not provided, the script will prompt interactively.

set -e

# Default values
NAME=""
API_KEY=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --name)
            NAME="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: ./scripts/setup.sh [--api-key <KEY>] [--name <NAME>]"
            echo ""
            echo "Options:"
            echo "  --api-key    VideoDB API key"
            echo "  --name       Your display name"
            echo ""
            echo "If omitted, you will be prompted to enter them."
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

# Interactive Prompts if missing
if [ -z "$API_KEY" ]; then
    echo ""
    echo "🔑 Enter your VideoDB API Key:"
    read -r -p "> " API_KEY
fi

# Validate API Key again
if [ -z "$API_KEY" ]; then
    echo "❌ Error: API Key is required."
    exit 1
fi

if [ -z "$NAME" ]; then
    echo ""
    echo "👤 Enter your Name (Default: Guest):"
    read -r -p "> " NAME
fi

# Default name if still empty
if [ -z "$NAME" ]; then
    NAME="Guest"
fi

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo ""
echo "📦 Installing dependencies..."
npm install

echo "🔑 Saving credentials..."
cat > auth_config.json << EOF
{
    "apiKey": "$API_KEY",
    "name": "$NAME"
}
EOF

echo ""
echo "✅ Setup complete!"
echo "   Name: $NAME"
echo ""
echo "🚀 Run 'npm start' to launch the app."
