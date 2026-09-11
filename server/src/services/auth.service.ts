import bcrypt from "bcryptjs";
import { userRepository } from "../repositories/userRepository";
import { signToken } from "../utils/jwt";
import { HttpError } from "../utils/HttpError";

export async function login(username: string, password: string) {
  const user = await userRepository.findByUsername(username);
  if (!user || !user.isActive) throw HttpError.unauthorized("Invalid username or password");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw HttpError.unauthorized("Invalid username or password");

  const authUser = { id: user.id, username: user.username, name: user.name, role: user.role };
  const token = signToken(authUser);
  return { token, user: authUser };
}
