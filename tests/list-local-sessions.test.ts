import { describe, expect, it } from "vitest";
import { createSession, listLocalSessions } from "@/lib/sessions";
import { imageFile } from "./helpers";

describe("listLocalSessions", () => {
  it("returns newest sessions first up to the limit", async () => {
    const first = await createSession(imageFile());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createSession(imageFile());

    const listed = await listLocalSessions({ limit: 10 });
    expect(listed.map((session) => session.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(listed[0]?.id).toBe(second.id);

    const capped = await listLocalSessions({ limit: 1 });
    expect(capped).toHaveLength(1);
    expect(capped[0]?.id).toBe(second.id);
  });
});
