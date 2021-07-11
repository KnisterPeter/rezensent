import { removeIndentation } from "./strings";

test.each([
  [`abc`, "abc"],
  [`abc\nabc`, "abc\nabc"],
  [`\n    abc\n    abc\n  `, "abc\nabc"],
  [`\n    abc\n\n    abc\n  `, "abc\n\nabc"],
  [`\n      abc\n\n    abc\n  `, "  abc\n\nabc"],
])("Should remove leading indentation from the given text", (text, result) => {
  expect(removeIndentation(text)).toBe(result);
});

test("Should remove leading indentation when used as tagged template string", () => {
  expect(removeIndentation`\n      abc\n\n    abc\n  `).toBe("  abc\n\nabc");

  const a = "abc";
  const b = 123;
  expect(removeIndentation`\n      ${a}\n\n    ${b}\n  `).toBe("  abc\n\n123");
});
