import fs from "node:fs";
import path from "node:path";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

export type TradingLogLevel = "debug" | "info" | "warn" | "error";

const logsDir = path.resolve(process.cwd(), "logs");
fs.mkdirSync(logsDir, { recursive: true });

const tradingEngineLogger = createLogger({
  level: "debug",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
    format.errors({ stack: true }),
    format.json(),
  ),
  defaultMeta: { svc: "trading_engine" },
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      filename: path.join(logsDir, "trading-%DATE%.log"),
      datePattern: "YYYY-MM-DD-HH",
      maxSize: "20m",
      maxFiles: "48h",
      zippedArchive: false,
      level: "debug",
    }),
  ],
});

/**
 * Structured logs for the trading engine.
 * Writes to both console (PM2) and rotating local JSON files.
 */
export function tradingLog(
  level: TradingLogLevel,
  event: string,
  data: Record<string, unknown>,
): void {
  tradingEngineLogger.log(level, event, { event, ...data });
}
