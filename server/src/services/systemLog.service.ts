import { systemLogRepository } from "../repositories/systemLogRepository";

export function recordSystemLog(data: { event: string; fromVersion: string; toVersion: string }, userId?: number) {
  return systemLogRepository.create({ ...data, userId });
}

export function listSystemLog() {
  return systemLogRepository.findMany();
}
