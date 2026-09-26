import { describe, expect, it } from "vitest";
import { joinName, namesMatch, parseClientQuery, splitName } from "./client-name";

describe("splitName", () => {
  it("splits on the first space", () => {
    expect(splitName("Siobhan Kelly")).toEqual({
      firstName: "Siobhan",
      lastName: "Kelly",
    });
  });

  it("keeps a multi-word surname together", () => {
    expect(splitName("Jo de Souza")).toEqual({
      firstName: "Jo",
      lastName: "de Souza",
    });
  });

  it("treats a single word as a first name", () => {
    expect(splitName("Marcus")).toEqual({ firstName: "Marcus", lastName: null });
  });

  it("tidies stray whitespace", () => {
    expect(splitName("  Siobhan   Kelly ")).toEqual({
      firstName: "Siobhan",
      lastName: "Kelly",
    });
  });

  it("gives nulls for nothing", () => {
    expect(splitName(null)).toEqual({ firstName: null, lastName: null });
    expect(splitName("   ")).toEqual({ firstName: null, lastName: null });
  });
});

describe("joinName", () => {
  it("joins both halves", () => {
    expect(joinName("Siobhan", "Kelly")).toBe("Siobhan Kelly");
  });

  it("copes with either half missing", () => {
    expect(joinName("Marcus", null)).toBe("Marcus");
    expect(joinName(" ", "Kelly")).toBe("Kelly");
    expect(joinName(null, undefined)).toBeNull();
  });
});

describe("parseClientQuery", () => {
  it("is everything when empty", () => {
    expect(parseClientQuery("")).toEqual({ kind: "all" });
    expect(parseClientQuery("   ")).toEqual({ kind: "all" });
  });

  it("reads a space as first then last name", () => {
    expect(parseClientQuery("sio kel")).toEqual({
      kind: "name",
      first: "sio",
      rest: "kel",
      whole: "sio kel",
    });
  });

  it("keeps everything after the first space as the last name", () => {
    expect(parseClientQuery("jo de sou")).toMatchObject({
      first: "jo",
      rest: "de sou",
    });
  });

  it("reads one word as either name", () => {
    expect(parseClientQuery("kelly")).toEqual({
      kind: "name",
      first: "kelly",
      rest: null,
      whole: "kelly",
    });
  });

  it("reads a UK number as the stored international digits", () => {
    expect(parseClientQuery("07700 900")).toEqual({
      kind: "phone",
      digits: "447700900",
    });
  });

  it("leaves international and partial numbers alone", () => {
    expect(parseClientQuery("+44 7700")).toEqual({
      kind: "phone",
      digits: "447700",
    });
    expect(parseClientQuery("900123")).toEqual({
      kind: "phone",
      digits: "900123",
    });
  });

  it("does not treat one or two digits as a number", () => {
    expect(parseClientQuery("07")).toMatchObject({ kind: "name" });
  });

  it("reads an @ as an email", () => {
    expect(parseClientQuery("Sam@Ex")).toEqual({ kind: "email", text: "sam@ex" });
  });
});


describe("namesMatch", () => {
  it("matches the same person however much of the name was given", () => {
    expect(namesMatch("Sarah", "Sarah Friend")).toBe(true);
    expect(namesMatch("sarah friend", "Sarah Friend")).toBe(true);
    expect(namesMatch("Zoë O'Neill", "Zoe ONeill")).toBe(true);
  });

  it("does not match a different person, even one in the same family", () => {
    expect(namesMatch("Olivia Hart", "Sarah Friend")).toBe(false);
    expect(namesMatch("Amy Burns", "Claire Burns")).toBe(false);
    expect(namesMatch("Sarah Jones", "Sarah Friend")).toBe(false);
    expect(namesMatch("", "Sarah Friend")).toBe(false);
  });
});
