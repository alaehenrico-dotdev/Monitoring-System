import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/HttpError";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { pushEndpointSchema } from "../utils/pushEndpoint";
import { getAlerts, pushPublicKey, removePushSubscription, savePushSubscription } from "../services/alerts.service";

const router = Router();

// The bell and phone/desktop notifications are for the Supervisor/Admin only.
router.use(authenticate, authorize(ROLES.SUPERVISOR_ADMIN));

router.get("/", asyncHandler(async (_req, res) => {
  res.json(await getAlerts());
}));

router.get("/push-key", asyncHandler(async (_req, res) => {
  res.json({ publicKey: pushPublicKey() });
}));

const subscribeSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

router.post("/subscribe", asyncHandler(async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid subscription", parsed.error.flatten());
  await savePushSubscription(req.user!.id, parsed.data);
  res.status(201).json({ success: true });
}));

router.post("/unsubscribe", asyncHandler(async (req, res) => {
  const parsed = z.object({ endpoint: z.string().max(500) }).safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid request");
  await removePushSubscription(req.user!.id, parsed.data.endpoint);
  res.json({ success: true });
}));

export default router;
