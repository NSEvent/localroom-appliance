#!/bin/sh
export PATH="$HOME/hack/node/bin:/usr/local/bin:/usr/bin:$PATH"
export NEMOCLAW_GATEWAY_PORT=8100
exec nemoclaw sentinel exec --timeout 30 -- curl -fsS https://example.com
