import { describe, expect, it } from "vitest";
import { photosByMessage, readPhotoLine } from "./thread-photos";

const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 10, 0, s));

describe("readPhotoLine", () => {
  it("reads a photo with a caption", () => {
    expect(readPhotoLine("[Sent a photo] Can I get this?")).toEqual({ isPhoto: true, saved: true, caption: "Can I get this?" });
  });
  it("reads a photo that could not be kept", () => {
    expect(readPhotoLine("[Sent a photo that could not be saved]")).toEqual({ isPhoto: true, saved: false, caption: "" });
  });
  it("leaves other messages alone", () => {
    expect(readPhotoLine("Hello")).toEqual({ isPhoto: false, saved: false, caption: "Hello" });
  });
});

describe("photosByMessage", () => {
  const messages = [
    { id: "m1", role: "user", content: "Hi", createdAt: at(0) },
    { id: "m2", role: "user", content: "[Sent a photo] this one", createdAt: at(10) },
    { id: "m3", role: "assistant", content: "Lovely", createdAt: at(15) },
    { id: "m4", role: "user", content: "[Sent a photo]", createdAt: at(40) },
  ];

  it("puts each photo with the photo line before it", () => {
    const out = photosByMessage(messages, [
      { id: "p2", createdAt: at(41) },
      { id: "p1", createdAt: at(11) },
    ]);
    expect(out).toEqual({ m2: ["p1"], m4: ["p2"] });
  });

  it("keeps an album together on its one line", () => {
    const out = photosByMessage(messages, [
      { id: "a", createdAt: at(11) },
      { id: "b", createdAt: at(12) },
    ]);
    expect(out).toEqual({ m2: ["a", "b"] });
  });

  it("allows for a photo stored a moment before its line", () => {
    expect(photosByMessage(messages, [{ id: "p", createdAt: at(38) }])).toEqual({ m4: ["p"] });
  });

  it("ignores photos when the thread has no photo lines", () => {
    expect(photosByMessage([messages[0]], [{ id: "p", createdAt: at(1) }])).toEqual({});
  });

  it("never gives a photo to Kikai's or staff's messages", () => {
    const out = photosByMessage(
      [{ id: "k", role: "assistant", content: "[Sent a photo]", createdAt: at(0) }, ...messages],
      [{ id: "p", createdAt: at(1) }]
    );
    expect(out).toEqual({ m2: ["p"] });
  });
});
