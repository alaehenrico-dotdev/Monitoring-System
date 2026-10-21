import express, { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { MAX_EXPORT_BYTES } from "../services/drive.service";
import {
  getDriveCallback,
  getDriveExportConfig,
  getDriveStatus,
  patchDriveSettings,
  postDriveBackupNow,
  postDriveConnect,
  postDriveDisconnect,
  postDriveExportCopy,
} from "../controllers/drive.controller";

const router = Router();
const admin = [authenticate, authorize(ROLES.SUPERVISOR_ADMIN)];

// Where Google redirects the browser after consent. Deliberately not behind
// `authenticate` (a redirect carries no Authorization header); it is trusted
// only through the signed, ten-minute `state` that POST /connect issues.
router.get("/oauth/callback", asyncHandler(getDriveCallback));

// Settings > Google Drive: SUPERVISOR_ADMIN only, enforced here and not just by
// the client-side route guard.
router.get("/status", ...admin, asyncHandler(getDriveStatus));
router.post("/connect", ...admin, asyncHandler(postDriveConnect));
router.post("/disconnect", ...admin, asyncHandler(postDriveDisconnect));
router.patch("/settings", ...admin, asyncHandler(patchDriveSettings));
router.post("/backup-now", ...admin, asyncHandler(postDriveBackupNow));

// Every role exports, so every role can ask whether to send a copy and send it.
router.get("/export-config", authenticate, asyncHandler(getDriveExportConfig));
router.post(
  "/exports",
  authenticate,
  // The file itself is the body, whatever its Content-Type; capped, so one
  // request cannot buffer an arbitrary amount in memory.
  express.raw({ type: () => true, limit: MAX_EXPORT_BYTES }),
  asyncHandler(postDriveExportCopy),
);

export default router;
