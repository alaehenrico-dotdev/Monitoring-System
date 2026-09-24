import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

vi.mock("../repositories/deliveryDestinationRepository", () => ({
  deliveryDestinationRepository: {
    findAll: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({
  recordChange: vi.fn(),
}));

import { deliveryDestinationRepository } from "../repositories/deliveryDestinationRepository";
import { recordChange } from "./changeLog.service";
import {
  createDeliveryDestination,
  deactivateDeliveryDestination,
  listDeliveryDestinations,
  updateDeliveryDestination,
} from "./deliveryDestinations.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listDeliveryDestinations", () => {
  it("delegates to the repository with the includeInactive flag", async () => {
    vi.mocked(deliveryDestinationRepository.findAll).mockResolvedValue([]);
    await listDeliveryDestinations(true);
    expect(deliveryDestinationRepository.findAll).toHaveBeenCalledWith(true);
  });
});

describe("createDeliveryDestination", () => {
  it("creates the destination and records the change when the name is free", async () => {
    vi.mocked(deliveryDestinationRepository.findByName).mockResolvedValue(null);
    const created = { id: 1, name: "North Depot" };
    vi.mocked(deliveryDestinationRepository.create).mockResolvedValue(created as never);

    const result = await createDeliveryDestination({ name: "North Depot" }, 7);

    expect(deliveryDestinationRepository.create).toHaveBeenCalledWith({ name: "North Depot" });
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "DeliveryDestination", action: "CREATE", changedById: 7, newValue: created }),
    );
    expect(result).toBe(created);
  });

  it("rejects a duplicate name with HttpError.conflict", async () => {
    vi.mocked(deliveryDestinationRepository.findByName).mockResolvedValue({ id: 1, name: "North Depot" } as never);

    await expect(createDeliveryDestination({ name: "North Depot" }, 7)).rejects.toThrow(HttpError);
    expect(deliveryDestinationRepository.create).not.toHaveBeenCalled();
  });
});

describe("updateDeliveryDestination", () => {
  it("throws HttpError.notFound when the destination doesn't exist", async () => {
    vi.mocked(deliveryDestinationRepository.findById).mockResolvedValue(null);

    await expect(updateDeliveryDestination(999, { name: "New" }, 7)).rejects.toThrow(HttpError);
    expect(deliveryDestinationRepository.update).not.toHaveBeenCalled();
  });

  it("rejects renaming to a name already used by another destination", async () => {
    vi.mocked(deliveryDestinationRepository.findById).mockResolvedValue({ id: 1, name: "North Depot" } as never);
    vi.mocked(deliveryDestinationRepository.findByName).mockResolvedValue({ id: 2, name: "South Depot" } as never);

    await expect(updateDeliveryDestination(1, { name: "South Depot" }, 7)).rejects.toThrow(HttpError);
    expect(deliveryDestinationRepository.update).not.toHaveBeenCalled();
  });

  it("allows updating fields other than name without checking for a duplicate", async () => {
    const existing = { id: 1, name: "North Depot", isActive: true, sortOrder: 1 };
    vi.mocked(deliveryDestinationRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(deliveryDestinationRepository.update).mockResolvedValue({ ...existing, sortOrder: 2 } as never);

    await updateDeliveryDestination(1, { sortOrder: 2 }, 7);

    expect(deliveryDestinationRepository.findByName).not.toHaveBeenCalled();
    expect(deliveryDestinationRepository.update).toHaveBeenCalledWith(1, { sortOrder: 2 });
  });
});

describe("deactivateDeliveryDestination", () => {
  it("updates isActive to false via updateDeliveryDestination", async () => {
    const existing = { id: 1, name: "North Depot" };
    vi.mocked(deliveryDestinationRepository.findById).mockResolvedValue(existing as never);
    vi.mocked(deliveryDestinationRepository.update).mockResolvedValue({ ...existing, isActive: false } as never);

    await deactivateDeliveryDestination(1, 7);

    expect(deliveryDestinationRepository.update).toHaveBeenCalledWith(1, { isActive: false });
  });
});
