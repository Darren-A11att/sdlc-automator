// =============================================================================
// devserver/dev-server.ts - Dev server lifecycle management
//
// Manages starting, readiness polling, and stopping a development server.
// Reuses an existing server if the port is already in use.
// =============================================================================

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { DevServerConfig } from "../types.js";
import type Logger from "../logging/logger.js";

export class DevServer {
  private proc: ChildProcess | null = null;
  private weStarted = false;

  constructor(
    private config: DevServerConfig,
    private projectDir: string,
    private logFile: string,
    private logger: Logger,
  ) {}

  /**
   * Start the dev server if not already running.
   * Returns true if the server is ready, false on timeout.
   */
  async start(): Promise<boolean> {
    // Check if port is already in use
    if (await this.isPortInUse()) {
      this.logger.log("INFO", `Dev server already running on port ${this.config.port} — reusing`);
      return true;
    }

    this.logger.log("INFO", `Starting dev server: ${this.config.startCommand} (port ${this.config.port})`);

    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    fs.mkdirSync(logDir, { recursive: true });

    // Open log file for writing
    const logFd = fs.openSync(this.logFile, "w");

    // Parse command — split on first space for command vs args
    const parts = this.config.startCommand.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    this.proc = spawn(cmd, args, {
      cwd: this.projectDir,
      stdio: ["ignore", logFd, logFd],
      detached: false,
      env: { ...process.env },
    });

    this.weStarted = true;

    // Handle spawn errors
    this.proc.on("error", (err) => {
      this.logger.log("ERROR", `Dev server spawn error: ${err.message}`);
    });

    fs.closeSync(logFd);

    // Poll for readiness
    const timeoutMs = this.config.readinessTimeoutSeconds * 1000;
    const intervalMs = this.config.readinessIntervalSeconds * 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await this.sleep(intervalMs);

      if (await this.isPortInUse()) {
        // Port is listening — try HTTP health check
        if (await this.isHttpReady()) {
          this.logger.log("INFO", `Dev server ready on port ${this.config.port}`);
          return true;
        }
      }

      // Check if process exited unexpectedly
      if (this.proc.exitCode !== null) {
        this.logger.log("ERROR", `Dev server exited with code ${this.proc.exitCode}`);
        return false;
      }
    }

    this.logger.log("ERROR", `Dev server readiness timeout after ${this.config.readinessTimeoutSeconds}s`);
    this.stop();
    return false;
  }

  /**
   * Stop the dev server if we started it.
   * Sends SIGTERM, waits 5s, then SIGKILL if still running.
   */
  stop(): void {
    if (!this.weStarted || !this.proc) {
      return;
    }

    this.logger.log("INFO", "Stopping dev server...");

    try {
      this.proc.kill("SIGTERM");
    } catch {
      // Process may already be dead
    }

    // Wait up to 5 seconds for graceful shutdown, then SIGKILL
    const killTimeout = setTimeout(() => {
      try {
        if (this.proc && this.proc.exitCode === null) {
          this.logger.log("WARN", "Dev server did not stop gracefully, sending SIGKILL");
          this.proc.kill("SIGKILL");
        }
      } catch {
        // Ignore
      }
    }, 5000);

    this.proc.on("exit", () => {
      clearTimeout(killTimeout);
    });

    this.weStarted = false;
    this.proc = null;
  }

  /**
   * Check if the configured port is in use.
   */
  get isRunning(): boolean {
    // Synchronous check — for cleanup guards only.
    // For actual readiness, use start() which does async checks.
    return this.weStarted && this.proc !== null && this.proc.exitCode === null;
  }

  private isPortInUse(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port: this.config.port, host: "127.0.0.1" });
      socket.setTimeout(1000);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  private isHttpReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.config.port}/`, (res) => {
        // Any response (even 404) means the server is ready
        res.resume();
        resolve(true);
      });
      req.setTimeout(2000);
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
