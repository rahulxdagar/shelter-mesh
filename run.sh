#!/usr/bin/env bash
set -e

# Resolve repository root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  cat << 'EOF'
Usage: ./run.sh [--docker | --local]

Options:
  --docker    Run the project using Docker Compose
  --local     Install dependencies on local system and run development servers
  -h, --help  Display this help message
EOF
  exit 1
}

MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)
      MODE="docker"
      shift
      ;;
    --local)
      MODE="local"
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Error: Unknown option '$1'" >&2
      usage
      ;;
  esac
done

if [ -z "$MODE" ]; then
  echo "Error: Please specify either --docker or --local." >&2
  usage
fi

if [ "$MODE" = "docker" ]; then
  echo "=========================================="
  echo " Running Cold-Grid with Docker Compose"
  echo "=========================================="
  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: Docker is not installed or not in PATH." >&2
    exit 1
  fi

  if [ ! -f .env ]; then
    echo "Notice: .env not found. Creating default .env configuration for Docker Compose..."
    cat << 'EOF' > .env
AUTH0_DOMAIN=dev.local.auth0.com
AUTH0_AUDIENCE=https://api.coldgrid
DEMO_CONTROLS=true
EOF
  fi

  if docker compose version >/dev/null 2>&1; then
    docker compose up --build
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose up --build
  else
    echo "Error: Neither 'docker compose' nor 'docker-compose' is available." >&2
    exit 1
  fi

elif [ "$MODE" = "local" ]; then
  echo "=========================================="
  echo " Installing packages and running locally"
  echo "=========================================="
  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is not installed or not in PATH." >&2
    exit 1
  fi

  echo "==> Installing dependencies across root, server, and web..."
  npm run setup

  echo "==> Starting local development servers (API on :8080, Web on :5173)..."
  npm run dev
fi
