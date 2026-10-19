// @vitest-environment edge-runtime
//
// Email triage B5 (docs/prd-email-triage.md §5.4, D9, I4): the pure RFC 2822
// / MIME builder — headers (Message-ID, In-Reply-To, References, encoded
// Subject with Hungarian accents), multipart with attachments, base64url.

import { describe, expect, it } from "vitest";
import {
  bareMessageId,
  buildGmailRaw,
  buildMimeMessage,
  encodeWords,
  formatAddress,
  fromBase64Url,
  generateMessageId,
  MAX_LINE_LENGTH,
  MESSAGE_ID_MAX,
  MimeBuildError,
  replySubject,
  toBase64Url,
  type MimeMessageInput,
} from "../mime";

const SUBJECT = "Re: Árvíztűrő tükörfúrógép – Black Friday bannerek (1200×628) ✓ őszi kampány, ütemterv és visszaszámláló";

/** Decode every RFC 2047 B-word in a header value (and unfold it). */
function decodeHeader(value: string): string {
  const unfolded = value.replace(/\r\n /g, " ");
  return unfolded.replace(/(=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=)(\s+(?==\?UTF-8\?B\?))?/g, (_m, _w, b64: string) => {
    const bin = atob(b64);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  });
}

/** Header block → { name: value } (folded lines joined). */
function headersOf(message: string): Record<string, string> {
  const block = message.split("\r\n\r\n")[0];
  const out: Record<string, string> = {};
  let last = "";
  for (const line of block.split("\r\n")) {
    if (line.startsWith(" ") && last) {
      out[last] += `\r\n${line}`;
    } else {
      const i = line.indexOf(":");
      last = line.slice(0, i);
      out[last] = line.slice(i + 2);
    }
  }
  return out;
}

const base64ToText = (b64: string) => {
  const bin = atob(b64.replace(/\r\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

function input(extra: Partial<MimeMessageInput> = {}): MimeMessageInput {
  return {
    from: { name: "Tóth Ádám", email: "Adam@Agency.test" },
    to: [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }],
    cc: [{ name: "Nagy Gábor", email: "gabor@pragmatico.hu" }, { email: "info@pragmatico.hu" }],
    subject: SUBJECT,
    bodyText: "Szia Réka!\n\nKöszönjük, elkezdtük. Szerdáig küldjük a bannereket.\n\nÜdv,\nÁdám",
    messageId: "<0f9e1c2a-1111-4222-8333-444455556666@agency.test>",
    inReplyTo: "<m2@pragmatico.hu>",
    references: ["<m1@pragmatico.hu>", "<out1@agency.test>", "<m2@pragmatico.hu>"],
    date: Date.UTC(2026, 9, 16, 8, 5, 0),
    ...extra,
  };
}

describe("headers", () => {
  it("is pure ASCII with CRLF line ends and every required header", () => {
    const msg = buildMimeMessage(input());
    expect(/^[\x00-\x7f]*$/.test(msg)).toBe(true);
    expect(msg.includes("\n") && !/[^\r]\n/.test(msg)).toBe(true);
    const h = headersOf(msg);
    expect(h["Message-ID"]).toBe("<0f9e1c2a-1111-4222-8333-444455556666@agency.test>");
    expect(h["In-Reply-To"]).toBe("<m2@pragmatico.hu>");
    expect(h["References"].split("\r\n ")).toEqual(["<m1@pragmatico.hu>", "<out1@agency.test>", "<m2@pragmatico.hu>"]);
    expect(h["Date"]).toBe("Fri, 16 Oct 2026 08:05:00 +0000");
    expect(h["MIME-Version"]).toBe("1.0");
    expect(h["Content-Type"]).toBe('text/plain; charset="UTF-8"');
    expect(h["Content-Transfer-Encoding"]).toBe("base64");
  });

  it("encodes a Hungarian subject as ≤ 75-char UTF-8 encoded-words that decode back exactly", () => {
    const h = headersOf(buildMimeMessage(input()));
    const words = h["Subject"].split("\r\n ");
    expect(words.length).toBeGreaterThan(1); // long subject → folded
    for (const w of words) {
      expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(w.length).toBeLessThanOrEqual(75);
    }
    expect(decodeHeader(h["Subject"])).toBe(SUBJECT);
  });

  it("never splits a multi-byte character across encoded-words", () => {
    const text = "ő".repeat(100) + "✓".repeat(30);
    for (const w of encodeWords(text)) {
      // Each word decodes on its own (a cut sequence would throw with fatal: true).
      const b64 = w.slice("=?UTF-8?B?".length, -2);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).not.toThrow();
    }
    expect(decodeHeader(encodeWords(text).join("\r\n "))).toBe(text);
  });

  it("keeps a plain ASCII subject as-is and a reply subject locked to the thread", () => {
    expect(headersOf(buildMimeMessage(input({ subject: "Re: Black Friday" })))["Subject"]).toBe("Re: Black Friday");
    expect(replySubject("Black Friday")).toBe("Re: Black Friday");
    expect(replySubject("")).toBe("Re:");
  });

  it("formats addresses: encoded non-ASCII names, quoted ASCII names, lower-cased emails", () => {
    const h = headersOf(buildMimeMessage(input()));
    expect(decodeHeader(h["From"])).toBe("Tóth Ádám <adam@agency.test>");
    expect(h["To"]).toMatch(/^=\?UTF-8\?B\?.+\?= <reka@pragmatico\.hu>$/);
    expect(decodeHeader(h["Cc"])).toBe("Nagy Gábor <gabor@pragmatico.hu>, info@pragmatico.hu");
    expect(formatAddress({ name: 'Smith, "J"', email: "j@x.com" })).toBe('"Smith, \\"J\\"" <j@x.com>');
    expect(formatAddress({ name: "j@x.com", email: "J@X.com" })).toBe("j@x.com");
  });

  it("strips CR/LF from header values (no header injection)", () => {
    const msg = buildMimeMessage(input({ subject: "Hello\r\nBcc: evil@x.com", from: { name: "A\r\nBcc: e@x.com", email: "a@b.hu" } }));
    expect(msg).not.toMatch(/^Bcc:/m);
    expect(headersOf(msg)["Subject"]).toBe("Hello Bcc: evil@x.com");
  });

  it("refuses an invalid address, a malformed Message-ID and an empty To", () => {
    expect(() => buildMimeMessage(input({ to: [{ email: "not an email" }] }))).toThrow(MimeBuildError);
    expect(() => buildMimeMessage(input({ to: [{ email: "a@b.hu>\r\nBcc: x@y.hu" }] }))).toThrow(MimeBuildError);
    expect(() => buildMimeMessage(input({ messageId: "no-brackets@x" }))).toThrow(MimeBuildError);
    expect(() => buildMimeMessage(input({ to: [] }))).toThrow(MimeBuildError);
  });
});

describe("body", () => {
  it("is base64 UTF-8 in ≤ 76-char lines with CRLF newlines", () => {
    const msg = buildMimeMessage(input());
    const body = msg.split("\r\n\r\n").slice(1).join("\r\n\r\n").trimEnd();
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(base64ToText(body)).toBe(input().bodyText.replace(/\n/g, "\r\n"));
  });
});

describe("multipart with attachments", () => {
  it("wraps the text and each file in multipart/mixed with encoded filenames", () => {
    const pdf = new Uint8Array(3000).map((_, i) => (i * 37) % 256);
    const msg = buildMimeMessage(
      input({
        boundary: "=_af_test",
        attachments: [
          { filename: "Ütemterv – őszi.pdf", mimeType: "application/pdf", bytes: pdf },
          { filename: "banner.png", mimeType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) },
        ],
      }),
    );
    const h = headersOf(msg);
    expect(h["Content-Type"]).toBe('multipart/mixed; boundary="=_af_test"');
    const parts = msg.split("--=_af_test");
    expect(parts.at(-1)).toBe("--\r\n"); // closing delimiter
    expect(parts.length).toBe(5); // preamble + text + 2 files + close
    expect(parts[1]).toContain('Content-Type: text/plain; charset="UTF-8"');
    const pdfPart = parts[2];
    const pdfHeaders = headersOf(pdfPart.replace(/^\r\n/, ""));
    expect(pdfHeaders["Content-Type"].replace(/\r\n /g, " ")).toMatch(/^application\/pdf; name="=\?UTF-8\?B\?/);
    expect(decodeHeader(pdfHeaders["Content-Disposition"].replace(/"/g, ""))).toBe("attachment; filename=Ütemterv – őszi.pdf");
    const pdfB64 = pdfPart.split("\r\n\r\n")[1].trim();
    const bytes = Uint8Array.from(atob(pdfB64.replace(/\r\n/g, "")), (c) => c.charCodeAt(0));
    expect([...bytes]).toEqual([...pdf]);
    expect(parts[3]).toContain('Content-Disposition: attachment;\r\n filename="banner.png"');
  });
});

describe("RFC 5322 line length", () => {
  it("folds long encoded names and filenames, caps References — no line over 998 chars", () => {
    const longName = "Árvíztűrő Tükörfúrógép Kft. ".repeat(20); // > 200 chars, non-ASCII
    const ids = Array.from({ length: 30 }, (_, i) => `<ref-${i}@pragmatico.hu>`);
    const overlong = `<${"x".repeat(300)}@pragmatico.hu>`;
    const msg = buildMimeMessage(
      input({
        from: { name: longName, email: "adam@agency.test" },
        to: Array.from({ length: 25 }, (_, i) => ({ name: longName, email: `r${i}@pragmatico.hu` })),
        references: [...ids.slice(0, 15), overlong, ...ids.slice(15)],
        attachments: [{ filename: `${"Ütemterv őszi kampány ".repeat(20)}.pdf`, mimeType: "application/pdf", bytes: new Uint8Array(10) }],
      }),
    );
    for (const line of msg.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    const refs = headersOf(msg)["References"].split("\r\n ");
    expect(refs).toEqual(ids.slice(-20)); // the latest 20; the overlong id is dropped
    expect(MESSAGE_ID_MAX).toBe(250);
    expect(MAX_LINE_LENGTH).toBe(998);
  });

  it("refuses an overlong Message-ID of our own", () => {
    expect(() => buildMimeMessage(input({ messageId: `<${"x".repeat(300)}@agency.test>` }))).toThrow(MimeBuildError);
  });
});

describe("base64url raw + Message-ID", () => {
  it("raw is base64url without padding and round-trips to the message", () => {
    const raw = buildGmailRaw(input());
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(raw)).toBe(buildMimeMessage(input()));
    expect(() => toBase64Url("ő")).toThrow(MimeBuildError);
  });

  it("mints <uuid-v4@sending-mailbox-domain> Message-IDs", () => {
    const fixed = generateMessageId("adam@konverted.io", new Uint8Array(16).fill(0xab));
    expect(fixed).toBe("<abababab-abab-4bab-abab-abababababab@konverted.io>");
    const a = generateMessageId("Mari@Agency.Test");
    const b = generateMessageId("mari@agency.test");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^<[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@agency\.test>$/);
    expect(bareMessageId(a)).toBe(a.slice(1, -1));
    expect(() => generateMessageId("")).toThrow(MimeBuildError);
  });
});
