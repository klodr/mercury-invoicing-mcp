import { MercuryClient, MercuryError } from "../src/client.js";

describe("MercuryClient", () => {
  it("constructs with an API key", () => {
    const client = new MercuryClient({ apiKey: "test-key" });
    expect(client).toBeInstanceOf(MercuryClient);
  });

  it("uses custom base URL when provided", () => {
    const client = new MercuryClient({
      apiKey: "test-key",
      baseUrl: "https://custom.example.com/v1",
    });
    expect(client).toBeInstanceOf(MercuryClient);
  });
});

describe("MercuryError", () => {
  it("captures status and body", () => {
    const err = new MercuryError("boom", 401, { message: "unauthorized" });
    expect(err.message).toBe("boom");
    expect(err.status).toBe(401);
    expect(err.body).toEqual({ message: "unauthorized" });
    expect(err.name).toBe("MercuryError");
  });
});
