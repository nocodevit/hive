// `claude auth login` normally finishes via a localhost browser redirect and
// needs no typed input. But when that callback can't be reached it falls back to
// asking the user to paste an authorization code on stdin ("Paste code here if
// prompted >"). Hive streamed that prompt into a read-only div with no input, so
// the user was stuck — the child waited on stdin forever. This detects the
// paste-code prompt from the streamed output so the modal can reveal an input
// wired to the child's stdin (auth:submitCode).

/**
 * True when the accumulated auth-login output is asking for a pasted code.
 * Matches the CLI's prompt phrasings without being so loose it fires on the
 * sign-in URL line itself.
 */
export function expectsPasteCode(output: string): boolean {
  if (!output) return false
  return /paste (the )?code/i.test(output) || /paste .*authorization code/i.test(output) || /enter the code/i.test(output)
}
