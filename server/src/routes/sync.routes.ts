import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { getSyncPull, postSyncPush } from "../controllers/sync.controller";

const router = Router();

// Desktop app offline sync (client/src/tauri/sync) - per-table write
// permission is enforced inside postSyncPush itself (a push batch can mix
// tableNames, so a single router-level `authorize(...)` can't express it).
router.get("/pull", authenticate, asyncHandler(getSyncPull));
router.post("/push", authenticate, asyncHandler(postSyncPush));

export default router;
