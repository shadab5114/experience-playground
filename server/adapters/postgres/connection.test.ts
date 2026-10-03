import { describe, expect, test } from "vitest";
import { dbConnectionFromEnv } from "./connection";

describe("dbConnectionFromEnv", () => {
  test("defaults to SSL off with no CA file", () => {
    expect(dbConnectionFromEnv({ DATABASE_URL: "postgres://u:p@h:5432/d" })).toEqual({
      url: "postgres://u:p@h:5432/d",
      ssl: false,
    });
  });

  test("DATABASE_SSL=on enables verified SSL and carries the CA file", () => {
    expect(
      dbConnectionFromEnv({
        DATABASE_URL: "postgres://u:p@aurora.example:5432/d",
        DATABASE_SSL: "on",
        DATABASE_SSL_CA_FILE: "/etc/ssl/rds-ca.pem",
      }),
    ).toEqual({ url: "postgres://u:p@aurora.example:5432/d", ssl: true, caFile: "/etc/ssl/rds-ca.pem" });
  });

  test("rejects a missing URL and an unknown SSL value", () => {
    expect(() => dbConnectionFromEnv({})).toThrow("DATABASE_URL");
    expect(() => dbConnectionFromEnv({ DATABASE_URL: "postgres://x", DATABASE_SSL: "require" })).toThrow(
      "DATABASE_SSL",
    );
  });
});
