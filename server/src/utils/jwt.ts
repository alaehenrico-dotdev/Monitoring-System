import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthUser } from "../types/express";

export function signToken(user: AuthUser, expiresIn: string = env.jwtExpiresIn): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, env.jwtSecret) as AuthUser;
}
