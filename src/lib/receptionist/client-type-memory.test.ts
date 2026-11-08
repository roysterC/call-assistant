import { describe, expect, it } from "vitest";
import { ClientTypeMemory } from "./client-type-memory";

describe("whether the caller has been before, once said", () => {
  it("is carried from the diary check to the read-back", () => {
    const m = new ClientTypeMemory();
    m.apply("check_availability", { service: "full colour", customerName: "Roy", clientType: "new" });
    expect(m.apply("prepare_booking", { service: "full colour", customerName: "Roy" })).toMatchObject({
      clientType: "new",
    });
  });

  it("said before the name was taken, counts for the name given next", () => {
    const m = new ClientTypeMemory();
    m.apply("check_availability", { service: "full colour", newClient: false });
    expect(m.apply("prepare_booking", { customerName: "Roy" })).toMatchObject({ clientType: "returning" });
  });

  it("is not taken to be true of someone else they book for", () => {
    const m = new ClientTypeMemory();
    m.apply("check_availability", { customerName: "Claire Burns", clientType: "returning" });
    expect(m.apply("prepare_booking", { customerName: "Amy Burns" })).not.toHaveProperty("clientType");
  });

  it("never overrides what the model sends, and leaves other tools alone", () => {
    const m = new ClientTypeMemory();
    m.apply("check_availability", { customerName: "Roy", clientType: "new" });
    expect(m.apply("prepare_booking", { customerName: "Roy", clientType: "returning" })).toMatchObject({
      clientType: "returning",
    });
    expect(m.apply("take_message", { customerName: "Roy" })).not.toHaveProperty("clientType");
  });

  it("knows nothing until it is told", () => {
    expect(new ClientTypeMemory().apply("prepare_booking", { customerName: "Roy" })).not.toHaveProperty(
      "clientType"
    );
  });
});
