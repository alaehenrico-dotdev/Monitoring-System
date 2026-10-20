import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { exportChangeLog, getArchive, getCellHistoryHandler, getChangeLog, getSheetPublishHistory, getSheetVersionRows, getSheetVersions, postArchiveRun, postRestoreSheetVersion } from "../controllers/changeLog.controller";

const router = Router();

// Section 3.2 - only the Supervisor/Admin reviews the log.
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getChangeLog));

// Rows older than the retention period live in change_log_archive; listed
// separately so the main page stays fast however old the database is.
router.get("/archive", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getArchive));
router.post("/archive/run", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postArchiveRun));

// Same Supervisor/Admin rule: the export is the full list, just as a file.
router.get("/export", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(exportChangeLog));

// Section 3.1 - "who last changed this cell" is part of encoding, not
// auditing: an encoder correcting a figure needs to see whether someone else
// already touched it. Open to every role that can open a stock grid, unlike
// the full Change Log above - the handler restricts it to the grid tables and
// returns only the one field asked for, never a whole row snapshot.
router.get("/cell", authenticate, asyncHandler(getCellHistoryHandler));

// Version history of a stock sheet (Online, Offline, Manual Count) and the
// Manual Count's publish history, rebuilt from change_log - no extra storage.
// Supervisor/Admin only, like the Change Log it reads from.
router.get("/sheet/versions", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getSheetVersions));
router.get("/sheet/version", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getSheetVersionRows));
router.get("/sheet/publishes", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getSheetPublishHistory));
// Apply a version: writes that version's figures back through the normal entry save.
router.post("/sheet/restore", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postRestoreSheetVersion));

export default router;
