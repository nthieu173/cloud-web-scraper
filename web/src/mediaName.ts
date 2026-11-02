/** A media link's file name, percent-decoded where that is valid. */
export function mediaName(link: string): string {
  const segment = new URL(link).pathname.split("/").at(-1) ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
