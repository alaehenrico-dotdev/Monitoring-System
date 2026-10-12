import { Role } from "@prisma/client";

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  /// Token version the session was issued under (JWT claim `tv`); compared with
  /// users.tokenVersion on every request. Absent on tokens issued before the
  /// column existed, which count as version 0.
  tv?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /// Correlation id assigned by middleware/requestLogger.ts. The access
      /// log line, the error log line and the error response all carry it,
      /// so a user reporting "it failed at 2pm" can be matched to the exact
      /// request and stack trace without grepping by timestamp.
      id?: string;
    }
  }
}

export {};
