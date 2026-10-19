import { describe, expect, it } from "vitest";
import {
  CONNECTOR_CATALOG,
  CONNECTORS_LOCATION,
  classifyConnection,
  connectorGuidanceMessage,
  getConnectorCatalog,
  getConnectorMeta,
  isConnectionUsable,
  isConnectorType,
  type ConnectorStatus,
} from "./connectors";

describe("connector catalog", () => {
  it("surfaces exactly the Echo dev connector while the email-triage gate is closed", () => {
    const catalog = getConnectorCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog.map((c) => c.type)).toEqual(["echo"]);
    expect(getConnectorCatalog({ emailTriage: false }).map((c) => c.type)).toEqual(["echo"]);
  });

  it("adds Gmail only when the email-triage gate is open (I14)", () => {
    expect(getConnectorCatalog({ emailTriage: true }).map((c) => c.type)).toEqual(["echo", "gmail"]);
  });

  it("every entry's key matches its type; token connectors back at least one tool", () => {
    for (const [key, meta] of Object.entries(CONNECTOR_CATALOG)) {
      expect(meta.type).toBe(key);
      expect(meta.displayName.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      if (meta.authKind === "token") expect(meta.toolNames.length).toBeGreaterThan(0);
    }
  });

  it("Gmail is a gated OAuth connector with read + send scopes", () => {
    const gmail = CONNECTOR_CATALOG.gmail;
    expect(gmail).toMatchObject({ authKind: "oauth", featureGate: "emailTriage", toolNames: [] });
    expect(gmail.defaultScopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
  });

  it("Echo is trivial token auth with one tool", () => {
    const echo = CONNECTOR_CATALOG.echo;
    expect(echo.authKind).toBe("token");
    expect(echo.toolNames).toEqual(["echo"]);
    expect(echo.defaultScopes.length).toBeGreaterThan(0);
  });

  it("recognizes live types and rejects unknown ones", () => {
    expect(isConnectorType("echo")).toBe(true);
    expect(isConnectorType("gmail")).toBe(true);
    expect(isConnectorType("slack")).toBe(false);
    expect(isConnectorType("")).toBe(false);
    expect(isConnectorType(null)).toBe(false);
    expect(getConnectorMeta("echo")?.displayName).toBe("Echo");
    expect(getConnectorMeta("nope")).toBeNull();
  });
});

describe("classifyConnection", () => {
  it("only `connected` is usable; everything else is not", () => {
    expect(classifyConnection("connected")).toEqual({ ok: true });
    expect(isConnectionUsable("connected")).toBe(true);

    const failing: ConnectorStatus[] = ["expired", "error", "revoked"];
    for (const status of failing) {
      expect(classifyConnection(status)).toEqual({ ok: false, reason: status });
      expect(isConnectionUsable(status)).toBe(false);
    }
  });

  it("a missing connection (null) reports the distinct `missing` reason", () => {
    expect(classifyConnection(null)).toEqual({ ok: false, reason: "missing" });
    expect(isConnectionUsable(null)).toBe(false);
  });
});

describe("connectorGuidanceMessage", () => {
  const echo = CONNECTOR_CATALOG.echo;

  it("names the connector and where to connect it (US 40)", () => {
    const msg = connectorGuidanceMessage(echo, "missing");
    expect(msg).toContain("Echo");
    expect(msg).toContain(CONNECTORS_LOCATION);
    expect(msg.toLowerCase()).toContain("connect");
  });

  it("says 'connect' for a first-time connection, 'reconnect' otherwise", () => {
    expect(connectorGuidanceMessage(echo, "missing").toLowerCase()).not.toContain(
      "reconnect",
    );
    for (const reason of ["revoked", "expired", "error"] as const) {
      expect(connectorGuidanceMessage(echo, reason).toLowerCase()).toContain(
        "reconnect",
      );
    }
  });

  it("every failure reason yields a distinct, non-empty message", () => {
    const reasons = ["missing", "expired", "error", "revoked"] as const;
    const messages = reasons.map((r) => connectorGuidanceMessage(echo, r));
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(reasons.length);
  });
});
