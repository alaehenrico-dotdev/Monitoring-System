import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/jwt", () => ({ verifyToken: vi.fn() }));
vi.mock("./cache", () => ({ invalidatePrefix: vi.fn() }));

import { invalidatePrefix } from "./cache";
import { broadcastRealtimeEvent } from "./realtime";

beforeEach(() => vi.clearAllMocks());

describe("broadcastRealtimeEvent", () => {
  it("drops the cached days-of-stock aggregate, so the dashboard tallies with the data that just changed", () => {
    broadcastRealtimeEvent();
    expect(invalidatePrefix).toHaveBeenCalledWith("days-of-stock:");
  });
});
