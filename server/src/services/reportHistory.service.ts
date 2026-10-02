import { reportHistoryRepository } from "../repositories/reportHistoryRepository";

export function recordReportHistory(data: { type: string; scope: string; route: string }, userId?: number) {
  return reportHistoryRepository.create({ ...data, generatedById: userId });
}

export function listReportHistory(type?: string) {
  return reportHistoryRepository.findMany({ type });
}
