import { describe, expect, it } from "vitest";
import { redactError } from "@/lib/portrait-archive";

describe("redactError", () => {
  it("keeps the guest's mobile out of a Storage error", () => {
    const error = Object.assign(
      new Error(
        "upload failed: https://storage.googleapis.com/upload/b?name=identities%2Fmobile_0912345678%2Fs1%2Finput",
      ),
      { code: 503, response: { url: "identities/mobile_0912345678/s1/input" } },
    );

    const logged = JSON.stringify(redactError(error));

    expect(logged).not.toContain("0912345678");
    expect(logged).not.toContain("response");
    expect(redactError(error)).toMatchObject({ code: 503 });
  });

  it("handles non-Error values", () => {
    expect(redactError("plain identities/mobile_0912345678/x")).toEqual({
      message: "plain identities/mobile_***/x",
    });
  });
});
