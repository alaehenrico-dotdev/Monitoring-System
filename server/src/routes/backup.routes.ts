import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getBackupDownload } from "../controllers/backup.controller";

const router = Router();

// Section Admin - Database Backup. SUPERVISOR_ADMIN-only, enforced here (not
// just by the client-side route guard around the Settings page).
router.get("/download", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getBackupDownload));

export default router;
