import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { authLimiter, loginIpLimiter, mfaLimiter, emailVerifyLimiter, resetCodeLimiter, resetRequestAccountLimiter, resetRequestLimiter } from "../middleware/rateLimit";
import { getMe, postChangePassword, postLogin, postMfaDisable, postMfaEnable, postMfaLogin, postMfaSetup, postSignOutEverywhere, postForgotPasswordReset, postForgotPasswordRequest, postRecoveryEmail, postVerifyEmail, postVerifyPassword } from "../controllers/auth.controller";

const router = Router();

// Everything here hands out or reflects credentials: session tokens, the authenticator
// secret, recovery codes. The API-wide "private, no-cache" would still let a browser keep a
// copy; this tells it not to store any of it.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post("/login", loginIpLimiter, authLimiter, asyncHandler(postLogin));
router.post("/login/mfa", mfaLimiter, asyncHandler(postMfaLogin));
router.post("/forgot-password/reset", loginIpLimiter, resetCodeLimiter, asyncHandler(postForgotPasswordReset));
router.post("/forgot-password/request", loginIpLimiter, resetRequestLimiter, resetRequestAccountLimiter, asyncHandler(postForgotPasswordRequest));
router.post("/email/verify", loginIpLimiter, emailVerifyLimiter, asyncHandler(postVerifyEmail));
router.post("/recovery-email", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), mfaLimiter, asyncHandler(postRecoveryEmail));
router.get("/me", authenticate, asyncHandler(getMe));
router.post("/change-password", authenticate, asyncHandler(postChangePassword));
router.post("/verify-password", mfaLimiter, authenticate, asyncHandler(postVerifyPassword));
router.post("/sign-out-everywhere", authenticate, asyncHandler(postSignOutEverywhere));
router.post("/mfa/setup", authenticate, asyncHandler(postMfaSetup));
router.post("/mfa/enable", authenticate, asyncHandler(postMfaEnable));
router.post("/mfa/disable", authenticate, asyncHandler(postMfaDisable));

export default router;
