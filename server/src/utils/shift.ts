import { Shift } from "@prisma/client";
import { HttpError } from "./HttpError";

export function parseShift(value: unknown): Shift {
  if (value === "MORNING" || value === "NIGHT") return value;
  throw HttpError.badRequest('Expected shift to be "MORNING" or "NIGHT"');
}
