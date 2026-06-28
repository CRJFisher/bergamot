import { sha256_hex } from "./content_hash";

// Pins the exact algorithm and encoding (SHA-256, utf-8 input, lowercase hex
// output). content_hash is durable fidelity metadata used to detect content
// drift across re-downloads; a silent change to the encoding would make every
// stored digest mismatch and falsely flag drift, so the well-known vectors are
// load-bearing rather than incidental.
describe("sha256_hex", () => {
  it("hashes the empty string to the known SHA-256 vector", () => {
    expect(sha256_hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes a known string to its NIST SHA-256 vector", () => {
    expect(sha256_hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("encodes input as utf-8, so a multi-byte character hashes its utf-8 bytes", () => {
    expect(sha256_hex("é")).toBe(
      "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
    );
  });
});
