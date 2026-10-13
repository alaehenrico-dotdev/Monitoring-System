import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getClientErrors, postClientError } from "../controllers/clientError.controller";

const router = Router();

// A crash loop in a browser must not be able to flood the table: per-IP cap,
// well under the global limiter.
const reportLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many error reports." },
});

router.post("/", reportLimiter, asyncHandler(postClientError));
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getClientErrors));

export default router;
