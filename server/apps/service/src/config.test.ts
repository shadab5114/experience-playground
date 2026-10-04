import { describe, expect, test } from "vitest";
import { loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgres://user:pw@localhost:5433/experience_agent",
  ANTHROPIC_BASE_URL: "https://gateway.example.test",
  ANTHROPIC_API_KEY: "sk-ant-config-test-secret",
  MODEL_ID: "test-model",
};

describe("loadConfig", () => {
  test("reads the model settings and applies defaults", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      ANTHROPIC_BASE_URL: "https://gateway.example.test",
      ANTHROPIC_API_KEY: "sk-ant-config-test-secret",
      MODEL_ID: "test-model",
      MODEL_TIMEOUT_MS: 60_000,
      RUN_LOCK_POOL_SIZE: 10,
      DS_PACK: "vds",
    });
  });

  test("treats empty RAG settings as unset", () => {
    const config = loadConfig({ ...base, RAG_BASE_URL: "", RAG_API_KEY: "" });
    expect(config.RAG_BASE_URL).toBeUndefined();
    expect(config.RAG_API_KEY).toBeUndefined();
  });

  test("names the missing model setting without echoing any value", () => {
    const { ANTHROPIC_API_KEY: _omit, ...withoutKey } = base;
    let message = "";
    try {
      loadConfig(withoutKey);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).not.toContain("sk-ant-config-test-secret");
  });

  test("rejects a base URL that is not a URL, without echoing it", () => {
    expect(() => loadConfig({ ...base, ANTHROPIC_BASE_URL: "not a url with a secret" })).toThrow(/ANTHROPIC_BASE_URL/);
  });
});
