#!/bin/sh
set -eu

PORT="${1:-4173}"
cd "$HOME/hack/localroom"
export PATH="$HOME/hack/node/bin:/usr/local/bin:/usr/bin:$PATH"
export ASR_URL="http://127.0.0.1:8001"
export QWEN_URL="http://127.0.0.1:8080/v1"
export NEMOTRON_URL="http://127.0.0.1:8092/v1"
export FAST_MODEL_URL="http://127.0.0.1:8093/v1"
export TTS_URL="http://127.0.0.1:8003/synthesize"
export OPENSHELL_DENIAL_COMMAND="$HOME/hack/localroom/prove-denial.sh"
export CA_CERT_PATH="$HOME/hack/localroom/certs/localroom-ca.pem"
export PORT

if [ "$PORT" = "4174" ]; then
  export TLS_KEY="$HOME/hack/localroom/certs/localroom-key.pem"
  export TLS_CERT="$HOME/hack/localroom/certs/localroom.pem"
fi

exec npm start
