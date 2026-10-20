// @vitest-environment edge-runtime
//
// Email triage B3 (docs/prd-email-triage.md §5.2 steps 3–4): the inbound
// RFC 822 / MIME parser against Hungarian-shaped fixtures from Gmail, Outlook
// and Apple Mail — charsets (utf-8, iso-8859-2, windows-1250, windows-1252),
// quoted-printable, base64, encoded-word headers and filenames, nested
// multipart, inline images, forwards (message/rfc822), calendar invites,
// HTML-only mail, caps and malformed input.

import { describe, expect, it } from "vitest";
import {
  MAX_ADDRESSES,
  base64DecodedSize,
  decodeQuotedPrintable,
  bytesToBinary,
  decodeCharset,
  decodeGmailRaw,
  decodeHeaderValue,
  htmlToText,
  parseMailDate,
  parseRawEmail,
} from "../mimeParse";
import { isBulkOrAutomated, stripQuoted } from "../model";

// ─── Fixture helpers (independent of the parser's own tables) ────────────────

const CRLF = "\r\n";
const utf8 = (s: string) => new TextEncoder().encode(s);
/** A message from lines (CRLF), as the raw UTF-8 bytes on the wire. */
const eml = (lines: string[]) => utf8(lines.join(CRLF));
/** base64 of the UTF-8 bytes, in 76-char lines. */
const b64 = (s: string) => wrap(btoa(bytesToBinary(utf8(s))));
const b64bin = (bin: string) => wrap(btoa(bin));
const wrap = (s: string) => s.replace(/(.{76})/g, `$1${CRLF}`).replace(/\r\n$/, "");

/** Hungarian letters + Windows quotes in iso-8859-2 / windows-1250 (the same bytes for these letters). */
const LEGACY: Record<string, number> = {
  á: 0xe1, é: 0xe9, í: 0xed, ó: 0xf3, ö: 0xf6, ő: 0xf5, ú: 0xfa, ü: 0xfc, ű: 0xfb,
  Á: 0xc1, É: 0xc9, Í: 0xcd, Ó: 0xd3, Ö: 0xd6, Ő: 0xd5, Ú: 0xda, Ü: 0xdc, Ű: 0xdb,
  "„": 0x84, "”": 0x94, "–": 0x96, // windows-1250 only
};
const legacyBin = (s: string) =>
  [...s].map((ch) => String.fromCharCode(ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : LEGACY[ch])).join("");

/** Quoted-printable of a binary string (soft breaks at 73 chars). */
function qpBin(bin: string): string {
  const lines = bin.split(/\r?\n/).map((line) => {
    let out = "";
    let len = 0;
    for (const ch of line) {
      const c = ch.charCodeAt(0);
      const enc = c >= 0x80 || ch === "=" ? `=${c.toString(16).toUpperCase().padStart(2, "0")}` : ch;
      if (len + enc.length > 73) {
        out += `=${CRLF}`;
        len = 0;
      }
      out += enc;
      len += enc.length;
    }
    return out;
  });
  return lines.join(CRLF);
}
const qp = (s: string) => qpBin(bytesToBinary(utf8(s)));

const bytesOf = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * seed + 13) & 0xff;
  return out;
};
const PDF_BYTES = utf8("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

// ─── Fixtures ────────────────────────────────────────────────────────────────

describe("Gmail", () => {
  it("1. multipart/alternative, utf-8 quoted-printable, encoded Subject / From", () => {
    const plain = [
      "Szia Ádám!",
      "",
      "Kérnénk két bannert a Black Friday kampányhoz: 1200×628 és 1080×1080.",
      "A 20% kedvezményt is írjátok rá.",
      "",
      "Köszi,",
      "Réka",
      "",
      "2026. okt. 16., P 15:12 dátummal Tóth Ádám <adam@konverted.io> ezt írta:",
      "> Szia Réka, mikorra kellene?",
    ].join("\n");
    const raw = eml([
      "MIME-Version: 1.0",
      "Date: Mon, 19 Oct 2026 10:12:00 +0200",
      "Message-ID: <CAF=k3x9@mail.gmail.com>",
      "In-Reply-To: <prev-1@konverted.io>",
      `Subject: =?UTF-8?B?${btoa(bytesToBinary(utf8("Re: Black Friday bannerek – árajánlat")))}?=`,
      "From: =?UTF-8?Q?Kov=C3=A1cs_R=C3=A9ka?= <Reka@Pragmatico.hu>",
      "To: =?UTF-8?B?VMOzdGggw4Fkw6Ft?= <adam@konverted.io>",
      'Content-Type: multipart/alternative; boundary="000000000000a1b2c3"',
      "",
      "--000000000000a1b2c3",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      qp(plain),
      "",
      "--000000000000a1b2c3",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      qp('<div dir="ltr">Szia Ádám!<br><br>Kérnénk két bannert…</div><div class="gmail_quote">…</div>'),
      "",
      "--000000000000a1b2c3--",
      "",
    ]);
    const p = parseRawEmail(raw);
    expect(p.subject).toBe("Re: Black Friday bannerek – árajánlat");
    expect(p.from).toEqual({ name: "Kovács Réka", email: "reka@pragmatico.hu" });
    expect(p.to).toEqual([{ name: "Tóth Ádám", email: "adam@konverted.io" }]);
    expect(p.messageId).toBe("<CAF=k3x9@mail.gmail.com>");
    expect(p.inReplyTo).toBe("<prev-1@konverted.io>");
    expect(p.date).toBe(Date.UTC(2026, 9, 19, 8, 12, 0));
    expect(p.text).toBe(plain);
    expect(p.textFromHtml).toBe(false);
    expect(p.html).toContain('<div dir="ltr">Szia Ádám!');
    expect(p.attachments).toEqual([]);
    // The stored bodyText is the stripped one (model.stripQuoted).
    expect(stripQuoted(p.text, { subject: p.subject }).text).not.toContain("mikorra kellene");
  });

  it("2. a forward as message/rfc822 stays text; its attachment is collected", () => {
    const innerSubject = "Őszi kampány brief";
    const raw = eml([
      "From: Tóth Ádám <adam@konverted.io>",
      "To: bence@konverted.io",
      "Subject: Fwd: Őszi kampány brief",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      "Lásd lent, Bence.",
      "--outer",
      "Content-Type: message/rfc822",
      'Content-Disposition: attachment; filename="brief.eml"',
      "",
      "From: Nagy Judit <judit@arlo.hu>",
      "Date: Fri, 16 Oct 2026 09:00:00 +0200",
      `Subject: =?UTF-8?B?${btoa(bytesToBinary(utf8(innerSubject)))}?=`,
      "To: adam@konverted.io",
      'Content-Type: multipart/mixed; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64("Eredeti kérés: három social poszt októberre."),
      "--inner",
      "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      'Content-Disposition: attachment; filename="brief.docx"',
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(2048))),
      "--inner--",
      "--outer--",
    ]);
    const p = parseRawEmail(raw);
    expect(p.subject).toBe("Fwd: Őszi kampány brief");
    expect(p.text).toContain("Lásd lent, Bence.");
    expect(p.text).toContain("---------- Forwarded message ---------");
    expect(p.text).toContain("From: Nagy Judit <judit@arlo.hu>");
    expect(p.text).toContain(`Subject: ${innerSubject}`);
    expect(p.text).toContain("Eredeti kérés: három social poszt októberre.");
    expect(p.attachments.map((a) => a.name)).toEqual(["brief.docx"]);
    expect(p.attachments[0].contentBytes?.length).toBe(2048);
    // A forward is content, never stripped as quoted history.
    expect(stripQuoted(p.text, { subject: p.subject }).text).toContain("Eredeti kérés");
  });
});

describe("Outlook", () => {
  it("3. iso-8859-2 quoted-printable inside mixed > alternative, a PDF with an encoded name", () => {
    const body = "Kedves Ádám!\n\nKérjük az őszi árajánlatot a csatolt PDF alapján.\n\nÜdvözlettel:\nSzűcs Ferenc";
    const raw = eml([
      "From: =?iso-8859-2?Q?Sz=FBcs_Ferenc?= <ferenc@pragmatico.hu>",
      "To: Tóth Ádám <adam@konverted.io>",
      "Subject: =?iso-8859-2?Q?=C1raj=E1nlat_k=E9r=E9s?=",
      "Thread-Topic: =?iso-8859-2?Q?=C1raj=E1nlat_k=E9r=E9s?=",
      "Date: Tue, 20 Oct 2026 08:30:00 +0000",
      "Message-ID: <DB9PR01MB1234ABCD@DB9PR01MB1234.eurprd01.prod.outlook.com>",
      'Content-Type: multipart/mixed; boundary="_004_DB9PR01MB1234_"',
      "MIME-Version: 1.0",
      "",
      "--_004_DB9PR01MB1234_",
      'Content-Type: multipart/alternative; boundary="_000_DB9PR01MB1234_"',
      "",
      "--_000_DB9PR01MB1234_",
      'Content-Type: text/plain; charset="iso-8859-2"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      qpBin(legacyBin(body)),
      "",
      "--_000_DB9PR01MB1234_",
      'Content-Type: text/html; charset="iso-8859-2"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      qpBin(legacyBin("<html><body><p>Kedves Ádám!</p><p>Kérjük az őszi árajánlatot</p></body></html>")),
      "",
      "--_000_DB9PR01MB1234_--",
      "",
      "--_004_DB9PR01MB1234_",
      'Content-Type: application/pdf; name="=?iso-8859-2?Q?aj=E1nlat_=F5szi.pdf?="',
      "Content-Description: =?iso-8859-2?Q?aj=E1nlat_=F5szi.pdf?=",
      'Content-Disposition: attachment; filename="=?iso-8859-2?Q?aj=E1nlat_=F5szi.pdf?="; size=60;',
      "\tcreation-date=\"Tue, 20 Oct 2026 08:29:00 GMT\"",
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(PDF_BYTES)),
      "",
      "--_004_DB9PR01MB1234_--",
      "",
    ]);
    const p = parseRawEmail(raw);
    expect(p.from).toEqual({ name: "Szűcs Ferenc", email: "ferenc@pragmatico.hu" });
    expect(p.subject).toBe("Árajánlat kérés");
    expect(p.text).toBe(body);
    expect(p.html).toContain("<p>Kérjük az őszi árajánlatot</p>");
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]).toMatchObject({ name: "ajánlat őszi.pdf", mime: "application/pdf", inline: false });
    expect(new TextDecoder().decode(p.attachments[0].contentBytes!)).toMatch(/^%PDF-1\.4/);
    expect(p.attachments[0].size).toBe(PDF_BYTES.length);
  });

  it("4. windows-1250 base64 body, a Q-encoded windows-1250 subject with „…” quotes", () => {
    const body = "A „Black Friday” banner őszi verziója – kérjük hétfőre.";
    const raw = eml([
      "From: Kiss Péter <peter@pragmatico.hu>",
      "To: adam@konverted.io",
      "Subject: =?windows-1250?Q?=84Black_Friday=94_banner_=F5szi?=",
      'Content-Type: text/plain; charset="windows-1250"',
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(legacyBin(body)),
    ]);
    const p = parseRawEmail(raw);
    expect(p.subject).toBe("„Black Friday” banner őszi");
    expect(p.text).toBe(body);
  });

  it("5. threading headers: folded References, a bare Message-ID, a Date with a comment", () => {
    const raw = eml([
      "From: reka@pragmatico.hu",
      "To: adam@konverted.io",
      "Subject: RE: Black Friday",
      "Date: Wed, 21 Oct 2026 16:05:09 +0200 (CEST)",
      "Message-ID: AM0PR02MB5555@eurprd02.prod.outlook.com",
      "In-Reply-To: <m2@konverted.io>",
      "References: <m0@pragmatico.hu>",
      " <m1@konverted.io>",
      "\t<m2@konverted.io>",
      "",
      "Rendben, köszönjük!",
    ]);
    const p = parseRawEmail(raw);
    expect(p.messageId).toBe("<AM0PR02MB5555@eurprd02.prod.outlook.com>");
    expect(p.inReplyTo).toBe("<m2@konverted.io>");
    expect(p.references).toEqual(["<m0@pragmatico.hu>", "<m1@konverted.io>", "<m2@konverted.io>"]);
    expect(p.date).toBe(Date.UTC(2026, 9, 21, 14, 5, 9));
    expect(p.text).toBe("Rendben, köszönjük!");
  });
});

describe("Apple Mail", () => {
  it("6. text / inline photo / text in multipart/mixed: both texts joined, the photo kept inline", () => {
    const raw = eml([
      "From: Kiss Péter <peter@pragmatico.hu>",
      "Content-Type: multipart/mixed;",
      '\tboundary="Apple-Mail=_5E1F2C3A-0001"',
      "Mime-Version: 1.0 (Mac OS X Mail 16.0)",
      "Subject: =?utf-8?Q?Fot=C3=B3_a_standr=C3=B3l?=",
      "",
      "--Apple-Mail=_5E1F2C3A-0001",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Type: text/plain;",
      "\tcharset=utf-8",
      "",
      qp("Szia!\n\nItt a fotó a standról:"),
      "--Apple-Mail=_5E1F2C3A-0001",
      "Content-Disposition: inline;",
      "\tfilename=IMG_0042.jpeg",
      "Content-Type: image/jpeg;",
      "\tx-unix-mode=0644;",
      "\tname=IMG_0042.jpeg",
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(12_000))),
      "--Apple-Mail=_5E1F2C3A-0001",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Type: text/plain;",
      "\tcharset=utf-8",
      "",
      qp("\nÜdv,\nPéter\n\nSent from my iPhone"),
      "--Apple-Mail=_5E1F2C3A-0001--",
    ]);
    const p = parseRawEmail(raw);
    expect(p.subject).toBe("Fotó a standról");
    expect(p.text).toContain("Itt a fotó a standról:");
    expect(p.text).toContain("Üdv,\nPéter");
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]).toMatchObject({ name: "IMG_0042.jpeg", mime: "image/jpeg", inline: true, size: 12_000 });
    // "Sent from my iPhone" is a signature to the stripper.
    expect(stripQuoted(p.text).text).not.toContain("Sent from my iPhone");
  });

  it("7. mixed > related > alternative: a small cid: logo dropped, a large cid: image and a PDF kept", () => {
    const raw = eml([
      "From: Nagy Judit <judit@arlo.hu>",
      "Subject: Arculat",
      'Content-Type: multipart/mixed; boundary="m"',
      "",
      "--m",
      'Content-Type: multipart/related; boundary="r"; type="multipart/alternative"',
      "",
      "--r",
      'Content-Type: multipart/alternative; boundary="a"',
      "",
      "--a",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Csatolom az új arculatot.",
      "--a",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Csatolom az új arculatot.</p><img src="cid:logo@arlo"><img src="cid:hero@arlo">',
      "--a--",
      "--r",
      "Content-Type: image/png; name=logo.png",
      "Content-ID: <logo@arlo>",
      "Content-Disposition: inline; filename=logo.png",
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(3_000))),
      "--r",
      "Content-Type: image/png",
      "Content-ID: <hero@arlo>",
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(40_000, 3))),
      "--r--",
      "--m",
      "Content-Type: application/pdf",
      'Content-Disposition: attachment; filename="arculat.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(PDF_BYTES)),
      "--m--",
    ]);
    const p = parseRawEmail(raw);
    expect(p.text).toBe("Csatolom az új arculatot.");
    expect(p.html).toContain("cid:hero@arlo");
    expect(p.skipped).toEqual(["inline_logo"]);
    expect(p.attachments.map((a) => [a.name, a.mime, a.inline, a.contentId])).toEqual([
      ["attachment-1.png", "image/png", true, "hero@arlo"],
      ["arculat.pdf", "application/pdf", false, null],
    ]);
    expect(p.attachments[0].contentBytes?.length).toBe(40_000);
  });
});

describe("Structure, filenames and special parts", () => {
  it("8. a calendar invite is not an attachment (text/calendar part + invite.ics)", () => {
    const raw = eml([
      "From: Google Calendar <calendar-notification@google.com>",
      "Subject: =?UTF-8?Q?Megh=C3=ADv=C3=B3:_Heti_egyeztet=C3=A9s?=",
      'Content-Type: multipart/mixed; boundary="cal"',
      "",
      "--cal",
      'Content-Type: multipart/alternative; boundary="alt"',
      "",
      "--alt",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Heti egyeztetés, kedd 10:00",
      "--alt",
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<p>Heti egyeztetés</p>",
      "--alt",
      "Content-Type: text/calendar; charset=UTF-8; method=REQUEST",
      "Content-Transfer-Encoding: 7bit",
      "",
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "END:VCALENDAR",
      "--alt--",
      "--cal",
      'Content-Type: application/ics; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      "Content-Transfer-Encoding: base64",
      "",
      b64("BEGIN:VCALENDAR\r\nEND:VCALENDAR"),
      "--cal--",
    ]);
    const p = parseRawEmail(raw);
    expect(p.subject).toBe("Meghívó: Heti egyeztetés");
    expect(p.text).toBe("Heti egyeztetés, kedd 10:00");
    expect(p.attachments).toEqual([]);
    expect(p.skipped).toEqual(["calendar", "calendar"]);
  });

  it("9. encoded filenames: RFC 2047 in quotes, RFC 2231 continuations, a nameless part", () => {
    const docName = "Ütemterv – őszi kampány.docx";
    const raw = eml([
      "From: reka@pragmatico.hu",
      "Subject: Fájlok",
      'Content-Type: multipart/mixed; boundary="f"',
      "",
      "--f",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Három fájl.",
      "--f",
      `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="=?UTF-8?B?${btoa(bytesToBinary(utf8(docName)))}?="`,
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(100))),
      "--f",
      "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition: attachment;",
      " filename*0*=utf-8''%C3%A1rlista%20;",
      " filename*1*=2026%20v%C3%A9gleges.xlsx",
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(200))),
      "--f",
      "Content-Type: image/png",
      "Content-Disposition: attachment",
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(300))),
      "--f",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Disposition: attachment; filename*=UTF-8''jegyzet%20%C5%91.txt",
      "",
      "csatolt jegyzet",
      "--f--",
    ]);
    const p = parseRawEmail(raw);
    expect(p.text).toBe("Három fájl.");
    expect(p.attachments.map((a) => a.name)).toEqual([docName, "árlista 2026 végleges.xlsx", "attachment-3.png", "jegyzet ő.txt"]);
    expect(p.attachments.map((a) => a.size)).toEqual([100, 200, 300, 15]);
  });

  it("10. encoded-words: a UTF-8 character split across words, Q underscores, mixed literal text", () => {
    const bytes = bytesToBinary(utf8("Árvíztűrő"));
    const w1 = btoa(bytes.slice(0, 1)); // half of "Á"
    const w2 = btoa(bytes.slice(1));
    expect(decodeHeaderValue(`=?UTF-8?B?${w1}?= =?UTF-8?B?${w2}?=`)).toBe("Árvíztűrő");
    expect(decodeHeaderValue("Re: =?utf-8?q?Black_Friday?= =?utf-8?q?_banner?=")).toBe("Re: Black Friday banner");
    expect(decodeHeaderValue("=?iso-8859-2?q?=F5szi?= kampány =?utf-8?b?w7x0ZW10ZXJ2?=")).toBe("őszi kampány ütemterv");
    expect(decodeHeaderValue("=?UTF-8*hu?Q?=C3=A9?=")).toBe("é");
    expect(decodeHeaderValue("Plain subject")).toBe("Plain subject");
  });

  it("11. a plain message with raw 8-bit UTF-8 headers and no MIME headers", () => {
    const raw = eml([
      "From: Kovács Réka <reka@pragmatico.hu>",
      "To: Tóth Ádám <adam@konverted.io>, \"Kiss, Bence\" <bence@konverted.io>",
      "Cc: gabor@pragmatico.hu",
      "Subject: Kérdés a hírlevélről",
      "",
      "Szia! Mikor megy ki a hírlevél?",
      "",
    ]);
    const p = parseRawEmail(raw);
    expect(p.from).toEqual({ name: "Kovács Réka", email: "reka@pragmatico.hu" });
    expect(p.to).toEqual([
      { name: "Tóth Ádám", email: "adam@konverted.io" },
      { name: "Kiss, Bence", email: "bence@konverted.io" },
    ]);
    expect(p.cc).toEqual([{ email: "gabor@pragmatico.hu" }]);
    expect(p.subject).toBe("Kérdés a hírlevélről");
    expect(p.text).toBe("Szia! Mikor megy ki a hírlevél?");
    expect(p.html).toBeNull();
  });

  it("12. an HTML-only message (base64): text from the HTML, entities decoded, styles dropped", () => {
    const html = [
      "<html><head><style>p{color:red}</style><title>x</title></head><body>",
      "<p>Kedves&nbsp;Ádám,</p>",
      "<p>a k&ouml;vetkez&#x151;ket k&eacute;rn&eacute;nk:</p>",
      "<ul><li>banner 1200&times;628</li><li>Tom &amp; Jerry poszt</li></ul>",
      "<div>Üdv,<br>Judit</div>",
      "</body></html>",
    ].join("\n");
    const raw = eml([
      "From: judit@arlo.hu",
      "Subject: Kérés",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64(html),
    ]);
    const p = parseRawEmail(raw);
    expect(p.textFromHtml).toBe(true);
    expect(p.html).toBe(html);
    expect(p.text).toBe(
      "Kedves Ádám,\n\na következőket kérnénk:\n\n- banner 1200×628\n- Tom & Jerry poszt\n\nÜdv,\nJudit",
    );
    expect(p.text).not.toContain("color:red");
  });

  it("13. a newsletter: List-* / Precedence headers reach the bulk signals", () => {
    const raw = eml([
      "From: Hírlevél <noreply@shop.example>",
      "List-Unsubscribe: <mailto:unsub@shop.example>, <https://shop.example/u>",
      "List-Id: Shop News <news.shop.example>",
      "Precedence: bulk",
      "Subject: =?utf-8?Q?=C5=90szi_le=C3=A1raz=C3=A1s?=",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Akció!",
    ]);
    const p = parseRawEmail(raw);
    expect(p.subject).toBe("Őszi leárazás");
    const signals = isBulkOrAutomated(p.headers, { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] });
    expect(signals.drop).toBe(true);
    expect(signals.reasons).toEqual(
      expect.arrayContaining(["precedence:bulk", "noreply_sender", "label:CATEGORY_PROMOTIONS", "list_unsubscribe", "list_id"]),
    );
  });

  it("14. an auto-reply (Auto-Submitted, X-Autoreply, encoded HU subject) is a drop signal", () => {
    const raw = eml([
      "From: Kovács Réka <reka@pragmatico.hu>",
      "Auto-Submitted: auto-replied",
      "X-Autoreply: yes",
      "Subject: =?UTF-8?Q?Automatikus_v=C3=A1lasz:_Black_Friday?=",
      "",
      "Szabadságon vagyok október 30-ig.",
    ]);
    const p = parseRawEmail(raw);
    expect(p.subject).toBe("Automatikus válasz: Black Friday");
    const signals = isBulkOrAutomated(p.headers);
    expect(signals.drop).toBe(true);
    expect(signals.reasons).toEqual(expect.arrayContaining(["auto_submitted:auto-replied", "autoreply_header", "autoreply_subject"]));
  });

  it("15. an attachment over the limit is listed with its size but never decoded", () => {
    const raw = eml([
      "From: reka@pragmatico.hu",
      'Content-Type: multipart/mixed; boundary="big"',
      "",
      "--big",
      "Content-Type: text/plain",
      "",
      "Nagy videó csatolva.",
      "--big",
      "Content-Type: video/mp4",
      'Content-Disposition: attachment; filename="spot.mp4"',
      "Content-Transfer-Encoding: base64",
      "",
      b64bin(bytesToBinary(bytesOf(3_000))),
      "--big--",
    ]);
    const p = parseRawEmail(raw, { maxAttachmentBytes: 1_000 });
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]).toMatchObject({ name: "spot.mp4", mime: "video/mp4", contentBytes: null, size: 3_000 });
  });

  it("16. caps: a long body is cut and flagged", () => {
    const raw = eml(["From: a@b.hu", "", "x".repeat(500)]);
    const p = parseRawEmail(raw, { maxTextChars: 50 });
    expect(p.text).toHaveLength(50);
    expect(p.truncated).toBe(true);
  });

  it("17. malformed input never throws: no boundary, unterminated multipart, empty, junk headers", () => {
    const noBoundary = parseRawEmail(eml(["From: a@b.hu", "Content-Type: multipart/mixed", "", "csak szöveg"]));
    expect(noBoundary.text).toBe("csak szöveg");

    const unterminated = parseRawEmail(
      eml([
        "From: a@b.hu",
        'Content-Type: multipart/alternative; boundary="u"',
        "",
        "preamble ignored",
        "--u",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Első rész",
        "--u",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>Első rész</p>",
      ]),
    );
    expect(unterminated.text).toBe("Első rész");
    expect(unterminated.html).toBe("<p>Első rész</p>");

    const empty = parseRawEmail("");
    expect(empty).toMatchObject({ from: null, subject: "", text: "", attachments: [], messageId: null });

    const junk = parseRawEmail(eml(["From mbox-line", "no colon here", "Subject: ok", "", "body"]));
    expect(junk.subject).toBe("ok");
    expect(junk.text).toBe("body");
  });

  it("18. windows-1252 smart quotes and iso-8859-1 accents", () => {
    const raw = eml([
      "From: john@client.example",
      "Content-Type: text/plain; charset=windows-1252",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "=93Hello=94 caf=E9 =96 na=EFve",
    ]);
    expect(parseRawEmail(raw).text).toBe("“Hello” café – naïve");
    expect(decodeCharset("caf\xe9", "ISO-8859-1")).toBe("café");
  });

  it("19. a boundary that prefixes the inner one is not confused with it", () => {
    const raw = eml([
      "From: a@b.hu",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      'Content-Type: multipart/alternative; boundary="b1-alt"',
      "",
      "--b1-alt",
      "Content-Type: text/plain",
      "",
      "inner plain",
      "--b1-alt",
      "Content-Type: text/html",
      "",
      "<b>inner html</b>",
      "--b1-alt--",
      "--b1",
      "Content-Type: text/plain",
      'Content-Disposition: attachment; filename="notes.txt"',
      "",
      "attached notes",
      "--b1--",
    ]);
    const p = parseRawEmail(raw);
    expect(p.text).toBe("inner plain");
    expect(p.html).toBe("<b>inner html</b>");
    expect(p.attachments.map((a) => a.name)).toEqual(["notes.txt"]);
  });

  it("20. Gmail's raw (base64url) round-trips, `-` and `_` included", () => {
    const message = bytesToBinary(eml(["From: a@b.hu", "Subject: ?>?>", "", "ÿþ~~~ őű"]));
    const base64url = btoa(message).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(base64url).toMatch(/[-_]/);
    expect(decodeGmailRaw(base64url)).toBe(message);
    expect(parseRawEmail(decodeGmailRaw(base64url)).text).toBe("ÿþ~~~ őű");
  });
});

describe("helpers", () => {
  it("decodeCharset: iso-8859-2, windows-1250, utf-8, an unknown label, unlabelled legacy bytes", () => {
    expect(decodeCharset(legacyBin("őű ŐŰ"), "iso-8859-2")).toBe("őű ŐŰ");
    expect(decodeCharset(legacyBin("„őszi”"), "windows-1250")).toBe("„őszi”");
    expect(decodeCharset(bytesToBinary(utf8("őszi")), "UTF-8")).toBe("őszi");
    expect(decodeCharset(bytesToBinary(utf8("őszi")), "x-unknown-charset")).toBe("őszi");
    expect(decodeCharset(legacyBin("hétfő"), undefined)).toBe("hétfő");
  });

  it("htmlToText keeps paragraphs and list items, collapses source whitespace", () => {
    expect(htmlToText("<div>\n  egy\n  kettő </div><div>három</div>")).toBe("egy kettő\nhárom");
    expect(htmlToText("<script>x()</script><p>a<br/>b</p>")).toBe("a\nb");
  });

  it("parseMailDate: RFC 2822 with and without the weekday; junk → null", () => {
    expect(parseMailDate("19 Oct 2026 10:00:00 +0200")).toBe(Date.UTC(2026, 9, 19, 8, 0, 0));
    expect(parseMailDate("Mon, 19 Oct 2026 10:00 -0000")).toBe(Date.UTC(2026, 9, 19, 10, 0, 0));
    expect(parseMailDate("not a date")).toBeNull();
    expect(parseMailDate(undefined)).toBeNull();
  });

  it("base64DecodedSize ignores line breaks and padding", () => {
    expect(base64DecodedSize("QUJD\r\nREVG")).toBe(6);
    expect(base64DecodedSize("QUI=")).toBe(2);
  });
});

describe("hostile input (security review H1, H2, M1)", () => {
  const fast = (fn: () => void, ms = 500) => {
    const started = performance.now();
    fn();
    expect(performance.now() - started).toBeLessThan(ms);
  };

  it("320 KB of `<!--`, a `<` with no `>` and long space runs stay linear", () => {
    fast(() => expect(htmlToText("<!--".repeat(80_000))).toBe(""));
    fast(() => expect(htmlToText(`a${"<".repeat(320_000)}`).startsWith("a<")).toBe(true));
    fast(() => expect(htmlToText(`<p>x${" ".repeat(320_000)}y</p>`)).toBe("x y"));
    fast(() => expect(htmlToText(`<script>${"<scrip".repeat(50_000)}`)).toBe(""));
    const raw = eml(["From: a@b.hu", "Content-Type: text/html; charset=utf-8", "", "<!--".repeat(80_000)]);
    fast(() => expect(parseRawEmail(raw).text).toBe(""));
  });

  it("80 KB of spaces: quoted-printable and the plain body stay linear", () => {
    fast(() => expect(decodeQuotedPrintable(`x${" ".repeat(80_000)}y`)).toBe(`x${" ".repeat(80_000)}y`));
    fast(() => expect(decodeQuotedPrintable(`x${" ".repeat(80_000)}\r\ny`)).toBe("x\r\ny"));
    const raw = eml(["From: a@b.hu", "Content-Transfer-Encoding: quoted-printable", "", `a${" ".repeat(80_000)}b${" ".repeat(80_000)}`]);
    fast(() => expect(parseRawEmail(raw).text).toBe(`a${" ".repeat(80_000)}b`));
  });

  it("every header line is capped, the first line too; a huge Subject is cut", () => {
    const raw = eml(["From: a@b.hu", `Subject: ${"S".repeat(200_000)}`, `X-Long: ${"x".repeat(50_000)}`, "", "body"]);
    const p = parseRawEmail(raw);
    expect(p.subject.length).toBeLessThanOrEqual(8_000);
    expect(p.headers.every((h) => h.value.length <= 8_000)).toBe(true);
    expect(p.text).toBe("body");
  });

  it("To / Cc keep 100 entries and count the overflow", () => {
    const many = Array.from({ length: 9_000 }, (_, i) => `u${i}@x.hu`).join(", ");
    const p = parseRawEmail(eml(["From: a@b.hu", `To: ${many}`, `Cc: ${many}`, "", "hi"]));
    expect(p.to).toHaveLength(MAX_ADDRESSES);
    expect(p.cc).toHaveLength(MAX_ADDRESSES);
    expect(p.toOverflow).toBeGreaterThan(0);
    expect(p.ccOverflow).toBeGreaterThan(0);
  });

  it("an encoded-word display name can never become the address (spoof)", () => {
    const fake = btoa(bytesToBinary(utf8("Kovács Réka <reka@pragmatico.hu>")));
    const p = parseRawEmail(eml([`From: =?UTF-8?B?${fake}?= <attacker@evil.example>`, "", "x"]));
    expect(p.from?.email).toBe("attacker@evil.example");
    expect(p.from?.name).toBe("Kovács Réka <reka@pragmatico.hu>");
    const q = parseRawEmail(eml(["From: =?utf-8?Q?reka=40pragmatico=2Ehu?=", "", "x"]));
    expect(q.from).toBeNull(); // no address in the raw header at all
  });
});

