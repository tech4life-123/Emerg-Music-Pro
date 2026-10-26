import { describe, expect, it } from "vitest";
import { UploadStage, uploadFailureText } from "@/lib/upload-errors";

describe("uploadFailureText", () => {
  it("says the sign-in expired for storage auth failures", () => {
    expect(uploadFailureText(new UploadStage("upload", "new row violates row-level security policy"), "photo")).toMatch(/sign-in looks expired/);
    expect(uploadFailureText(new UploadStage("upload", "Invalid JWT"), "photo")).toMatch(/sign-in looks expired/);
  });
  it("reports size and type problems", () => {
    expect(uploadFailureText(new UploadStage("upload", "The object exceeded the maximum allowed size"), "header")).toMatch(/too large/);
    expect(uploadFailureText(new UploadStage("upload", "mime type image/gif is not supported"), "photo")).toMatch(/not accepted/);
  });
  it("tells an encode failure from a save failure", () => {
    expect(uploadFailureText(new UploadStage("encode", "x"), "photo")).toMatch(/could not prepare/);
    expect(uploadFailureText(new UploadStage("save", "Feature one of your own published releases."), "photo")).toMatch(/Feature one/);
    expect(uploadFailureText(new UploadStage("save", ""), "photo")).toMatch(/could not be saved/);
  });
});
