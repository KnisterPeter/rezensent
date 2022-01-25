export function removeIndentation(
  input: string | TemplateStringsArray,
  ...values: unknown[]
): string {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    let i = 0;
    const combined = [input[i]];
    while (true) {
      if (i >= values.length) {
        break;
      }
      combined.push(String(values[i]));
      i++;
      if (i >= input.length) {
        break;
      }
      combined.push(input[i]);
    }
    text = combined.join("");
  }

  const lines = text.split("\n");

  const indentation = lines
    .filter((line): line is string => line.trim().length > 0)
    .map((line) => /(^\s*)/.exec(line))
    .filter((matcher): matcher is RegExpExecArray => Boolean(matcher))
    .map((matcher) => matcher[1])
    .filter((prefix): prefix is string => Boolean(prefix))
    .reduce(
      (shortest, prefix) =>
        prefix.length < shortest ? prefix.length : shortest,
      Number.MAX_SAFE_INTEGER
    );

  if (indentation === Number.MAX_SAFE_INTEGER) {
    return text;
  }

  const first = lines[0];
  const last = lines[lines.length - 1];
  const middle = lines.slice(1, lines.length - 1);

  const newLines = middle;
  if (first && first.trim().length > 0) {
    newLines.unshift(first);
  }
  if (last && last.trim().length > 0) {
    newLines.push(last);
  }

  return newLines.map((line) => line.substring(indentation)).join("\n");
}
