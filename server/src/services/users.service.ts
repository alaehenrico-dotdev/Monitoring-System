import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { userRepository } from "../repositories/userRepository";
import { HttpError } from "../utils/HttpError";

export async function listUsers() {
  return userRepository.findAllPublic();
}

export async function createUser(data: { name: string; username: string; password: string; role: Role }) {
  const existing = await userRepository.findByUsername(data.username);
  if (existing) throw HttpError.conflict(`Username "${data.username}" is already taken`);

  const passwordHash = await bcrypt.hash(data.password, 10);
  return userRepository.create({ name: data.name, username: data.username, passwordHash, role: data.role });
}

export async function setUserActive(userId: number, isActive: boolean) {
  const user = await userRepository.findById(userId);
  if (!user) throw HttpError.notFound("User not found");
  return userRepository.setActive(userId, isActive);
}
