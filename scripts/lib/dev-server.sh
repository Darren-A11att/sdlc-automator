#!/usr/bin/env bash
# dev-server.sh - Dev server lifecycle management
#
# Manages starting, readiness polling, and stopping a development server.
# Reuses an existing server if the port is already in use.
#
# Requires: DEV_SERVER_START_CMD, DEV_SERVER_PORT, DEV_SERVER_READINESS_TIMEOUT,
#           DEV_SERVER_READINESS_INTERVAL (set by load_project_config)

# --- Globals ---
DEV_SERVER_PID=""
DEV_SERVER_WE_STARTED=false

# is_port_in_use - Check if a port is in use
# Arguments:
#   $1: port number
# Returns: 0 if in use, 1 if not
is_port_in_use() {
  local port="$1"
  if command -v lsof > /dev/null 2>&1; then
    lsof -i :"$port" -sTCP:LISTEN > /dev/null 2>&1
  elif command -v ss > /dev/null 2>&1; then
    ss -tlnp | grep -q ":${port} "
  else
    # Fallback: try to connect
    (echo > /dev/tcp/127.0.0.1/"$port") 2>/dev/null
  fi
}

# start_dev_server - Start the dev server if not already running
# Uses: DEV_SERVER_START_CMD, DEV_SERVER_PORT, DEV_SERVER_READINESS_TIMEOUT,
#       DEV_SERVER_READINESS_INTERVAL, PROJECT_DIR
# Returns: 0 if server is ready, 1 on timeout/failure
start_dev_server() {
  local port="${DEV_SERVER_PORT:-3000}"
  local timeout="${DEV_SERVER_READINESS_TIMEOUT:-60}"
  local interval="${DEV_SERVER_READINESS_INTERVAL:-2}"

  # Check if port is already in use
  if is_port_in_use "$port"; then
    log "INFO" "Dev server already running on port ${port} — reusing"
    return 0
  fi

  log "INFO" "Starting dev server: ${DEV_SERVER_START_CMD} (port ${port})"

  # Ensure log directory exists
  local dev_log_dir="${LOGS_DIR}/dev-server"
  mkdir -p "$dev_log_dir"
  local dev_log_file="${dev_log_dir}/dev-server.log"

  # Start server in background
  cd "$PROJECT_DIR"
  ${DEV_SERVER_START_CMD} > "$dev_log_file" 2>&1 &
  DEV_SERVER_PID=$!
  DEV_SERVER_WE_STARTED=true

  log "INFO" "Dev server started with PID ${DEV_SERVER_PID}"

  # Poll for readiness
  local elapsed=0
  while [[ "$elapsed" -lt "$timeout" ]]; do
    sleep "$interval"
    elapsed=$((elapsed + interval))

    # Check if process is still alive
    if ! kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
      local exit_code
      wait "$DEV_SERVER_PID" 2>/dev/null
      exit_code=$?
      log "ERROR" "Dev server exited unexpectedly with code ${exit_code}"
      DEV_SERVER_PID=""
      DEV_SERVER_WE_STARTED=false
      return 1
    fi

    # Check if port is now in use
    if is_port_in_use "$port"; then
      # Try HTTP health check
      if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/" 2>/dev/null | grep -qE '^[0-9]+$'; then
        log "INFO" "Dev server ready on port ${port}"
        return 0
      fi
    fi
  done

  log "ERROR" "Dev server readiness timeout after ${timeout}s"
  stop_dev_server
  return 1
}

# stop_dev_server - Stop the dev server if we started it
# Sends SIGTERM, waits 5s, then SIGKILL if still running.
stop_dev_server() {
  if [[ "$DEV_SERVER_WE_STARTED" != "true" || -z "$DEV_SERVER_PID" ]]; then
    return 0
  fi

  log "INFO" "Stopping dev server (PID ${DEV_SERVER_PID})..."

  # Send SIGTERM
  kill "$DEV_SERVER_PID" 2>/dev/null || true

  # Wait up to 5 seconds for graceful shutdown
  local waited=0
  while [[ "$waited" -lt 5 ]]; do
    if ! kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
      log "INFO" "Dev server stopped"
      DEV_SERVER_PID=""
      DEV_SERVER_WE_STARTED=false
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  # Force kill
  log "WARN" "Dev server did not stop gracefully, sending SIGKILL"
  kill -9 "$DEV_SERVER_PID" 2>/dev/null || true
  wait "$DEV_SERVER_PID" 2>/dev/null || true

  DEV_SERVER_PID=""
  DEV_SERVER_WE_STARTED=false
}
