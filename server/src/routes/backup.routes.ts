import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getBackupDownload, getBackupHistory, postRestore, postValidate, postVerifyFile } from "../controllers/backup.controller";

const router = Router();

// Section Admin - Database Backup. SUPERVISOR_ADMIN-only, enforced here (not
// just by the client-side route guard around the Settings page).
router.get("/download", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getBackupDownload));

// Section Admin - Database Restore. Body is the raw .sql file (Content-Type
// application/sql, so express.json leaves the stream alone); also requires a
// passcode token - see postRestore.
router.post("/restore", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postRestore));

router.get("/history", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getBackupHistory));
// Read-only checks, so no passcode: nothing here writes to the live database.
router.post("/validate", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postValidate));
router.post("/verify-file", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postVerifyFile));

export default router;
