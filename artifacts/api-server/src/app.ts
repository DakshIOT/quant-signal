import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "file_too_large", message: "File exceeds the maximum allowed size." });
      return;
    }
    res.status(400).json({ error: "upload_error", message: err.message });
    return;
  }
  if (err.message && (err.message.includes("Only") || err.message.includes("allowed"))) {
    res.status(415).json({ error: "invalid_file_type", message: err.message });
    return;
  }
  next(err);
});

export default app;
