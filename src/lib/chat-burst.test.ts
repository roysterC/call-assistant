import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterQuiet, isHandled, MAX_WAIT_MS, QUIET_MS } from "./chat-burst";

describe("waiting for a quiet spell before replying", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("replies once, after they stop sending", async () => {
    const reply = vi.fn(async () => {});
    afterQuiet("c1", reply);
    await vi.advanceTimersByTimeAsync(2_000);
    afterQuiet("c1", reply);
    await vi.advanceTimersByTimeAsync(2_000);
    afterQuiet("c1", reply);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(reply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("never waits longer than the most, however much they keep sending", async () => {
    const reply = vi.fn(async () => {});
    for (let t = 0; t < MAX_WAIT_MS; t += 2_000) {
      afterQuiet("c2", reply);
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("answers what comes in during a reply after it, not alongside it", async () => {
    const order: string[] = [];
    let finish!: () => void;
    afterQuiet("c3", () => {
      order.push("first starts");
      return new Promise<void>((r) => (finish = () => (order.push("first ends"), r())));
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    afterQuiet("c3", async () => {
      order.push("second");
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(order).toEqual(["first starts"]);
    expect(isHandled("c3")).toBe(true);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["first starts", "first ends", "second"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(isHandled("c3")).toBe(false);
  });

  it("keeps each conversation to itself", async () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    afterQuiet("a", a);
    await vi.advanceTimersByTimeAsync(3_000);
    afterQuiet("b", b);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});
