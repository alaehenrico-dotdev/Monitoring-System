import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { deleteImportBatchHandler, getImportBatches, patchImportBatch, postImportBatch } from "../controllers/importBatch.controller";

const router = Router();

// Whoever can import (same roles as Manual Count's own PUT) can create a
// batch, finalize it, and see what's been imported so far.
const canImport = authorize(ROLES.SUPERVISOR_ADMIN, ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER);

router.get("/", authenticate, canImport, asyncHandler(getImportBatches));
router.post("/", authenticate, canImport, asyncHandler(postImportBatch));
router.patch("/:id", authenticate, canImport, asyncHandler(patchImportBatch));
// Deleting an entry reverts real, already-saved stock data (see
// importBatch.service.ts's revertImportBatch) - restricted to Supervisor/
// Admin only, same as ChangeLog's own view-only restriction, since this is
// the one action here that actually undoes something.
router.delete("/:id", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(deleteImportBatchHandler));

export default router;
