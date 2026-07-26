#!/bin/sh
set -eu

PORT="${1:-4173}"
APP_DIR="${LOCALROOM_APP_DIR:-$HOME/hack/localroom-appliance-current}"
DATA_DIR="${LOCALROOM_DATA_DIR:-$HOME/hack/localroom-appliance-data}"
CERT_DIR="${LOCALROOM_CERT_DIR:-$HOME/hack/localroom/certs}"

cd "$APP_DIR"
export PATH="$HOME/hack/node/bin:/usr/local/bin:/usr/bin:$PATH"
export ASR_URL="${ASR_URL:-http://127.0.0.1:8001}"
export QWEN_URL="${QWEN_URL:-http://127.0.0.1:8080/v1}"
export NEMOTRON_URL="${NEMOTRON_URL:-http://172.17.0.1:8090/v1}"
export FAST_MODEL_URL="${FAST_MODEL_URL:-http://127.0.0.1:8093/v1}"
export TTS_URL="${TTS_URL:-http://127.0.0.1:8003/synthesize}"
export OPENSHELL_DENIAL_COMMAND="${OPENSHELL_DENIAL_COMMAND:-$HOME/hack/localroom/prove-denial.sh}"
export CA_CERT_PATH="${CA_CERT_PATH:-$CERT_DIR/localroom-ca.pem}"
export LOCALROOM_DATA_DIR="$DATA_DIR"
export PORT

if [ "$PORT" = "4174" ]; then
  export TLS_KEY="${TLS_KEY:-$CERT_DIR/localroom-key.pem}"
  export TLS_CERT="${TLS_CERT:-$CERT_DIR/localroom.pem}"
fi

exec npm start
