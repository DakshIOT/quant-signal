import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import path from "path";
import { db } from "@workspace/db";
import { uploadedFilesTable, tradeHistoryTable } from "@workspace/db/schema";
import { ingestionService } from "../services/ingestionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, "..", "..", "uploads");
mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uuid = randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uuid}${ext}`);
  },
});

const imageFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only PNG, JPG, and WebP images are allowed"));
  }
};

const csvFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
    cb(null, true);
  } else {
    cb(new Error("Only CSV files are allowed"));
  }
};

const uploadScreenshot = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const uploadCsv = multer({
  storage,
  fileFilter: csvFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const router: IRouter = Router();

router.post("/upload/screenshot", uploadScreenshot.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "no_file", message: "No file uploaded" });
      return;
    }

    const uuid = path.parse(req.file.filename).name;
    const symbol = String(req.body?.["symbol"] || "");
    const timeframe = String(req.body?.["timeframe"] || "");

    await db.insert(uploadedFilesTable).values({
      uuid,
      originalName: req.file.originalname,
      fileType: "screenshot",
      mimeType: req.file.mimetype,
      size: req.file.size,
      storagePath: req.file.path,
      symbol: symbol || null,
      timeframe: timeframe || null,
    });

    res.json({
      fileId: uuid,
      filename: req.file.originalname,
      size: req.file.size,
      message: "Screenshot uploaded successfully. Use the fileId in your analysis.",
    });
  } catch (err) {
    req.log.error({ err }, "Error in /upload/screenshot");
    res.status(500).json({ error: "internal_error", message: "Upload failed" });
  }
});

router.post("/upload/trades", uploadCsv.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "no_file", message: "No file uploaded" });
      return;
    }

    const uuid = path.parse(req.file.filename).name;
    const fs = await import("fs");
    const csvContent = fs.readFileSync(req.file.path, "utf-8");

    const parsedRecords = ingestionService.parseTradeCSV(csvContent);

    await db.insert(uploadedFilesTable).values({
      uuid,
      originalName: req.file.originalname,
      fileType: "trades_csv",
      mimeType: req.file.mimetype || "text/csv",
      size: req.file.size,
      storagePath: req.file.path,
    });

    if (parsedRecords.length > 0) {
      await db.insert(tradeHistoryTable).values(
        parsedRecords.map((r) => ({
          uploadFileUuid: uuid,
          date: r.date,
          symbol: r.symbol,
          side: r.side,
          entry: r.entry,
          exit: r.exit,
          pnl: r.pnl,
        })),
      );
    }

    res.json({
      fileId: uuid,
      filename: req.file.originalname,
      totalRecords: parsedRecords.length,
      parsedRecords: parsedRecords.map((r) => ({
        date: r.date,
        symbol: r.symbol,
        side: r.side,
        entry: r.entry,
        exit: r.exit,
        pnl: r.pnl,
      })),
      message: `CSV parsed successfully. ${parsedRecords.length} trade records found. Use the fileId in your analysis.`,
    });
  } catch (err) {
    req.log.error({ err }, "Error in /upload/trades");
    res.status(500).json({ error: "internal_error", message: "Upload failed" });
  }
});

export default router;
