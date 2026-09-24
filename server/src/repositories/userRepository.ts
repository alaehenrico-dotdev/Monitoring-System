import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

export interface UserCreateData {
  name: string;
  username: string;
  passwordHash: string;
  role: Role;
}

/// Section 5.9 - users: login and role assignment.
export const userRepository = {
  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  findById(id: number) {
    return prisma.user.findUnique({ where: { id } });
  },

  /// Lean projection for the per-request revocation check in
  /// middleware/auth.ts - runs on every cache-miss for an authenticated
  /// request, so it skips passwordHash and everything else findById pulls.
  findStatus(id: number) {
    return prisma.user.findUnique({ where: { id }, select: { isActive: true, role: true } });
  },

  findAllPublic() {
    return prisma.user.findMany({ select: PUBLIC_USER_SELECT, orderBy: { name: "asc" } });
  },

  create(data: UserCreateData) {
    return prisma.user.create({ data, select: PUBLIC_USER_SELECT });
  },

  setActive(id: number, isActive: boolean) {
    return prisma.user.update({ where: { id }, data: { isActive }, select: PUBLIC_USER_SELECT });
  },
};
