import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getMine, getMyHistory, postMyEdit, getSubmissions, postMySubmit, postReopen, putMyLines } from "../controllers/countSubmissions.controller";

const router = Router();

// The auditor's own blind count. Everything under /mine is theirs alone and holds no system figure
// (middleware/auth.ts, auditorMayCall, lets an auditor reach these paths and nothing else).
router.get("/mine", authenticate, authorize(ROLES.AUDITOR), asyncHandler(getMine));
router.put("/mine/lines", authenticate, authorize(ROLES.AUDITOR), asyncHandler(putMyLines));
router.get("/mine/history", authenticate, authorize(ROLES.AUDITOR), asyncHandler(getMyHistory));
router.post("/mine/edit", authenticate, authorize(ROLES.AUDITOR), asyncHandler(postMyEdit));
router.post("/mine/submit", authenticate, authorize(ROLES.AUDITOR), asyncHandler(postMySubmit));

// The admin's side: every auditor's counts for a sheet, and sending some of them back to be recounted.
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getSubmissions));
router.post("/reopen", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postReopen));

export default router;
