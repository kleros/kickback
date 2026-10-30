import { expect } from "chai";
import { encodeAbiParameters, getAddress, parseEther, size } from "viem";

import {
  EVENT_FIELDS,
  MAX_TEMPLATE_BYTES,
  caseTemplate,
  genericCaseTemplateText,
  genericPolicyText,
  ipfsPathOf,
  templateValues,
} from "../local";

const ORGANISER = "0x259a1084C2043a7B3b5b288596E05C41b8EFa5d6";
const SAMPLE_WALLET = getAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
const POLICY = ipfsPathOf(genericPolicyText);
const DETAILS = {
  eventTitle: "Kickback test night",
  eventName: "Kickback Test",
  eventWhen: "Friday 12 March 2027, 19:00-23:00 CET",
  eventWhere: "Berlin",
  hosts: "Ann and Bob",
  eventLink: "https://luma.com/kickback-test",
};
const values = (over: Record<string, string> = {}): Record<string, string> => ({
  ...templateValues(
    { ...DETAILS, depositUnits: parseEther("0.01"), explorer: "https://etherscan.io", kleros: { policyURI: POLICY } },
    ORGANISER,
  ),
  ...over,
});
/** A minimal valid template; `over` replaces top-level fields of it. */
const tiny = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Did {{wallet}} attend?",
    question: "Did {{wallet}} attend?",
    description: "d",
    rulingOptions: { titles: ["Attended", "Did not attend"] },
    fileURI: "{{policyURI}}",
    aliases: { "{{wallet}}": "Challenger", "{{walletLower}}": "Challenger" },
    ...over,
  });

// Ported from kickback-legacy test/core.test.mjs (caseTemplate / templateValues), plus each check caseTemplate makes.
describe("caseTemplate", function () {
  for (const [eth, expected] of [
    ["0", "0.0 ETH"],
    ["1", "1.0 ETH"],
    ["42", "42.0 ETH"],
    ["0.01", "0.01 ETH"],
    ["1.000000000000000001", "1.000000000000000001 ETH"],
    ["0.000000000000000001", "0.000000000000000001 ETH"],
  ] as const) {
    it(`formats ${eth} ETH with the exact deposit text used in legacy case metadata`, function () {
      const actualValues = { ...values(), deposit: templateValues({ depositUnits: parseEther(eth) }).deposit! };
      const text = tiny({ description: "Deposit: {{deposit}}" });
      const actual = caseTemplate(text, actualValues);
      const expectedTemplate = caseTemplate(text, { ...actualValues, deposit: expected });
      expect(actualValues.deposit).to.equal(expected);
      expect(actual).to.deep.equal(expectedTemplate);
      expect(ipfsPathOf(actual.sample)).to.equal(ipfsPathOf(expectedTemplate.sample));
    });
  }

  it("the generic template uses every deploy-time value and the organiser", function () {
    const used = new Set([...genericCaseTemplateText.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
    expect([...used].sort()).to.deep.equal([
      "contract",
      "deposit",
      "eventLink",
      "eventName",
      "eventTitle",
      "eventWhen",
      "eventWhere",
      "explorer",
      "hosts",
      "owner",
      "ownerLower",
      "policyURI",
      "wallet",
      "walletLower",
    ]);
  });

  it("every field at its longest (3-byte characters, or quotes JSON doubles) is escaped and still fits", function () {
    const fills = [(n: number) => "€".repeat(n), (n: number) => '"\\'.repeat(n / 2)];
    for (const fill of fills) {
      const big = Object.fromEntries(
        EVENT_FIELDS.map((f) => [
          f.key,
          f.key === "eventLink" ? "https://x.io/" + "a".repeat(f.max - 13) : fill(f.max),
        ]),
      );
      const t = caseTemplate(genericCaseTemplateText, values(big));
      const bytes = size(encodeAbiParameters([{ type: "string[]" }, { type: "bytes" }], [t.pieces, t.slots]));
      expect(bytes).to.be.below(MAX_TEMPLATE_BYTES / 2);
      expect(JSON.parse(t.sample).question).to.include(big.eventTitle);
    }
  });

  it("quotes, backslashes, newlines and emoji in a value come back unchanged from the case JSON", function () {
    const title = 'The "Night" \\ part 2\nwith\ttabs 🎉 €';
    const t = caseTemplate(genericCaseTemplateText, values({ eventTitle: title }));
    const meta = JSON.parse(t.sample);
    expect(meta.question).to.equal(
      `Did the person who registered with wallet ${SAMPLE_WALLET} attend ${title} (${DETAILS.eventWhen})?`,
    );
  });

  it("a value that looks like a placeholder never becomes one", function () {
    const plain = caseTemplate(genericCaseTemplateText, values());
    const tricky = caseTemplate(genericCaseTemplateText, values({ hosts: "{{wallet}} and {{contract}}" }));
    expect(tricky.slots).to.equal(plain.slots);
    expect(JSON.parse(tricky.sample).description).to.include("hosted by {{wallet}} and {{contract}}");
  });

  it("refuses an empty event field, a missing organiser and an unknown placeholder", function () {
    expect(() => caseTemplate(genericCaseTemplateText, values({ eventWhere: "" }), { name: "the template" })).to.throw(
      /the template names the event's "Venue or city" \(\{\{eventWhere\}\}\), but it is empty/,
    );
    expect(() => caseTemplate(genericCaseTemplateText, values({ owner: "" }))).to.throw(/names the organiser's wallet/);
    expect(() => caseTemplate(tiny({ description: "{{nope}}" }), values())).to.throw(
      /Unknown placeholder \{\{nope\}\}/,
    );
  });

  it("refuses a template that never names the wallet as {{wallet}}", function () {
    const text = tiny({
      title: "Did {{walletLower}} attend?",
      question: "Did {{walletLower}} attend?",
      aliases: { "{{walletLower}}": "Challenger" },
    });
    expect(() => caseTemplate(text, values())).to.throw(/must name the challenged wallet \(\{\{wallet\}\}\)/);
  });

  it("refuses a fileURI other than the juror policy", function () {
    expect(() => caseTemplate(tiny({ fileURI: "/ipfs/QmOther" }), values())).to.throw(
      /"fileURI" must be the juror policy/,
    );
  });

  it("refuses a checksummed alias key without its lower-case twin", function () {
    expect(() => caseTemplate(tiny({ aliases: { "{{wallet}}": "Challenger" } }), values())).to.throw(
      /alias 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed also needs a lower-case key/,
    );
  });

  it("refuses invalid JSON, a missing title wallet, a missing description and wrong ruling options", function () {
    expect(() => caseTemplate(tiny().slice(0, -1), values())).to.throw(/is not valid JSON once filled in/);
    expect(() => caseTemplate(tiny({ question: "Did they attend? {{wallet}}", title: "x" }), values())).to.throw(
      /"title" must name the wallet/,
    );
    expect(() => caseTemplate(tiny({ description: "" }), values())).to.throw(/"description" is missing/);
    expect(() => caseTemplate(tiny({ rulingOptions: { titles: ["Yes"] } }), values())).to.throw(
      /"rulingOptions.titles" must list the 2 answers/,
    );
  });

  it("refuses a template over the contract's size limit and keeps one just under it", function () {
    const fill = (n: number) => tiny({ description: "d" + "x".repeat(n) });
    const encoded = (n: number) => {
      const t = caseTemplate(fill(n), values());
      return size(encodeAbiParameters([{ type: "string[]" }, { type: "bytes" }], [t.pieces, t.slots]));
    };
    const n = MAX_TEMPLATE_BYTES - encoded(0);
    // abi.encode pads each string to 32 bytes, so n is the last length that fits up to that padding
    expect(encoded(n - 32)).to.be.at.most(MAX_TEMPLATE_BYTES);
    expect(() => caseTemplate(fill(n + 32), values())).to.throw(/is too long/);
  });
});
