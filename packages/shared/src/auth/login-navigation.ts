/** Explain protected access before starting the external sign-in flow. */
export function loginNoticePath(returnTo: string): string {
  return `/login?return_to=${encodeURIComponent(returnTo)}`;
}
