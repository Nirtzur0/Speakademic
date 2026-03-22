#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────
# Speakademic — First-time setup script
# ─────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║     Speakademic — Setup Wizard       ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
  echo ""
}

check() { command -v "$1" &>/dev/null; }

banner

# ── Prerequisites ──────────────────────────────

echo -e "${YELLOW}Checking prerequisites...${NC}"

MISSING=()
check node   || MISSING+=("node (>= 20)")
check docker || MISSING+=("docker")
check npm    || MISSING+=("npm")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${RED}Missing:${NC} ${MISSING[*]}"
  echo "Install them and re-run this script."
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${RED}Node.js 20+ required (found $(node -v))${NC}"
  exit 1
fi

echo -e "${GREEN}All prerequisites met.${NC}"
echo ""

# ── Credentials ────────────────────────────────

ENV_FILE="backend/.env"

echo -e "${YELLOW}=== Credentials Setup ===${NC}"
echo ""
echo "You'll need these from external dashboards:"
echo "  1. Google Cloud Console → OAuth 2.0 Client ID"
echo "  2. Stripe Dashboard → API keys + product prices"
echo ""
echo "Leave blank to keep current placeholder values."
echo ""

read_with_default() {
  local prompt="$1"
  local current="$2"
  local varname="$3"
  local display_current

  if [[ "$current" == *"REPLACE_ME"* ]] || [[ "$current" == *"__"* ]]; then
    display_current="(not set)"
  else
    display_current="(set)"
  fi

  echo -ne "${CYAN}${prompt}${NC} ${display_current}: "
  read -r input
  if [ -n "$input" ]; then
    eval "$varname='$input'"
  else
    eval "$varname='$current'"
  fi
}

# Read current values from .env
get_env_val() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo ""
}

CURRENT_GOOGLE_ID=$(get_env_val GOOGLE_CLIENT_ID)
CURRENT_STRIPE_SK=$(get_env_val STRIPE_SECRET_KEY)
CURRENT_STRIPE_WH=$(get_env_val STRIPE_WEBHOOK_SECRET)
CURRENT_PRO_PRICE=$(get_env_val STRIPE_PRO_PRICE_ID)
CURRENT_UNL_PRICE=$(get_env_val STRIPE_UNLIMITED_PRICE_ID)
CURRENT_TTS_URL=$(get_env_val TTS_SERVER_URL)

echo -e "${YELLOW}── Google OAuth ──${NC}"
read_with_default "Google Client ID (without .apps.googleusercontent.com)" \
  "$CURRENT_GOOGLE_ID" NEW_GOOGLE_ID

echo ""
echo -e "${YELLOW}── Stripe ──${NC}"
read_with_default "Stripe Secret Key (sk_test_...)" \
  "$CURRENT_STRIPE_SK" NEW_STRIPE_SK
read_with_default "Stripe Webhook Secret (whsec_...)" \
  "$CURRENT_STRIPE_WH" NEW_STRIPE_WH
read_with_default "Stripe Pro Price ID (price_...)" \
  "$CURRENT_PRO_PRICE" NEW_PRO_PRICE
read_with_default "Stripe Unlimited Price ID (price_...)" \
  "$CURRENT_UNL_PRICE" NEW_UNL_PRICE

echo ""
echo -e "${YELLOW}── TTS Server ──${NC}"
read_with_default "TTS Server URL" \
  "${CURRENT_TTS_URL:-http://localhost:8880}" NEW_TTS_URL

# Generate JWT secret if still placeholder
CURRENT_JWT=$(get_env_val JWT_SECRET)
if [[ "$CURRENT_JWT" == *"change-me"* ]] || [ -z "$CURRENT_JWT" ]; then
  NEW_JWT=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)
  echo ""
  echo -e "${GREEN}Generated JWT secret.${NC}"
else
  NEW_JWT="$CURRENT_JWT"
fi

# ── Write .env ─────────────────────────────────

cat > "$ENV_FILE" <<EOF
# Server
PORT=3000
HOST=0.0.0.0

# Database (docker-compose overrides this)
DATABASE_URL=postgres://speakademic:localdev@localhost:5432/speakademic
DB_SSL=false

# JWT
JWT_SECRET=${NEW_JWT}

# Google OAuth
GOOGLE_CLIENT_ID=${NEW_GOOGLE_ID}

# Stripe
STRIPE_SECRET_KEY=${NEW_STRIPE_SK}
STRIPE_WEBHOOK_SECRET=${NEW_STRIPE_WH}
STRIPE_PRO_PRICE_ID=${NEW_PRO_PRICE}
STRIPE_UNLIMITED_PRICE_ID=${NEW_UNL_PRICE}

# TTS Server
TTS_SERVER_URL=${NEW_TTS_URL}

# CORS
CORS_ORIGIN=*
EOF

echo -e "${GREEN}Wrote backend/.env${NC}"

# ── Update extension placeholders ──────────────

# Extract just the client ID part (without .apps.googleusercontent.com)
GOOGLE_ID_BARE="${NEW_GOOGLE_ID%.apps.googleusercontent.com}"

# Update auth-client.js
sed -i.bak "s|'__GOOGLE_CLIENT_ID__'|'${GOOGLE_ID_BARE}'|g" \
  extension/utils/auth-client.js && rm -f extension/utils/auth-client.js.bak

# Update manifest.json
sed -i.bak "s|__GOOGLE_CLIENT_ID__|${GOOGLE_ID_BARE}|g" \
  extension/manifest.json && rm -f extension/manifest.json.bak

# Update service-worker.js Stripe price ID
sed -i.bak "s|'__STRIPE_PRO_PRICE_ID__'|'${NEW_PRO_PRICE}'|g" \
  extension/background/service-worker.js && rm -f extension/background/service-worker.js.bak

echo -e "${GREEN}Updated extension source files with credentials.${NC}"

# ── Install backend dependencies ───────────────

echo ""
echo -e "${YELLOW}Installing backend dependencies...${NC}"
cd backend && npm install && cd ..
echo -e "${GREEN}Dependencies installed.${NC}"

# ── Start services ─────────────────────────────

echo ""
echo -e "${YELLOW}Starting Postgres via Docker...${NC}"
docker compose up -d db
echo "Waiting for Postgres to be ready..."
sleep 3

echo -e "${YELLOW}Running database migrations...${NC}"
cd backend && node src/db/migrate.js && cd ..
echo -e "${GREEN}Migrations applied.${NC}"

# ── Done ───────────────────────────────────────

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Setup complete!                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "Next steps:"
echo ""
echo -e "  ${CYAN}1. Start the API server:${NC}"
echo "     cd backend && npm run dev"
echo ""
echo -e "  ${CYAN}2. Load the extension in Chrome:${NC}"
echo "     chrome://extensions → Developer mode → Load unpacked"
echo "     Select the 'extension/' directory"
echo ""
echo -e "  ${CYAN}3. (Optional) Start Kokoro TTS locally:${NC}"
echo "     docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi:latest"
echo ""
echo -e "  ${CYAN}4. Set up Stripe webhook (for local dev):${NC}"
echo "     stripe listen --forward-to localhost:3000/webhooks/stripe"
echo ""
echo -e "  ${CYAN}5. Deploy to production:${NC}"
echo "     See backend/railway.toml or backend/render.yaml"
echo ""
