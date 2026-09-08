import fs from "fs";
import path from "path";
import { isObjectLike } from "lodash-es";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { getAgentDir } from "@/shared/platform/paths";
import {
  safeStringifyPacket,
  sanitizeObject,
} from "@/shared/security/sensitiveDataMasking";

export type LogLevel = "info" | "warn" | "error" | "debug";

const LOG_RETENTION = "30d";
const LOG_MAX_SIZE = "10m";

/**
 * Safely stringify an object, handling circular references
 * This prevents "Converting circular structure to JSON" errors
 * when logging objects like axios errors that contain socket references
 */
function safeStringify(obj: unknown): string {
  try {
    return safeStringifyPacket(obj);
  } catch {
    return "[Unserializable]";
  }
}

class Logger {
  private winstonLogger: winston.Logger;
  private fileLoggingEnabled = false;

  constructor() {
    const consoleFormat = winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.printf(({ level, message }) => {
        return `[${level.toUpperCase()}] ${message}`;
      }),
    );

    const consoleTransport = new winston.transports.Console({
      level: "debug",
      format: consoleFormat,
    });

    consoleTransport.on("error", (error) => {
      console.error("Console transport error", error);
    });

    this.winstonLogger = winston.createLogger({
      level: "debug",
      transports: [consoleTransport],
      exitOnError: false,
    });
  }

  /**
   * Turns on rotating file output. Must be called explicitly by an application entry
   * point, importing this module must stay free of filesystem side effects. Safe to
   * call more than once; only the first call adds the file transport.
   */
  enableFileLogging(directory: string = getAgentDir()): void {
    if (this.fileLoggingEnabled) {
      return;
    }
    this.fileLoggingEnabled = true;

    if (!fs.existsSync(directory)) {
      try {
        fs.mkdirSync(directory, { recursive: true });
      } catch (e) {
        console.error("Failed to create agent directory for logs", e);
      }
    }

    const fileFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      }),
    );

    const rotateTransport = new DailyRotateFile({
      filename: path.join(directory, "app-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_RETENTION,
      zippedArchive: false,
      auditFile: path.join(directory, ".app-log-audit.json"),
      level: "debug",
      format: fileFormat,
    });

    rotateTransport.on("error", (error) => {
      console.error("DailyRotateFile transport error", error);
    });

    this.winstonLogger.add(rotateTransport);
  }

  private formatArgs(args: unknown[]): string {
    return args
      .map((arg) =>
        isObjectLike(arg) ? safeStringify(arg) : String(sanitizeObject(arg)),
      )
      .join(" ");
  }

  log(level: LogLevel, message: string, ...args: unknown[]) {
    const formattedArgs = this.formatArgs(args);
    const sanitizedMessage = String(sanitizeObject(message));
    const mergedMessage = formattedArgs
      ? `${sanitizedMessage} ${formattedArgs}`
      : sanitizedMessage;

    this.winstonLogger.log({
      level,
      message: mergedMessage,
    });
  }

  info(message: string, ...args: unknown[]) {
    this.log("info", message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    this.log("warn", message, ...args);
  }

  error(message: string, ...args: unknown[]) {
    this.log("error", message, ...args);
  }

  debug(message: string, ...args: unknown[]) {
    this.log("debug", message, ...args);
  }
}

export const logger = new Logger();
