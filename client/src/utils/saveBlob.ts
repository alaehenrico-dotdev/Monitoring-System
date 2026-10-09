/// Hands a Blob to the browser's normal "Save file" flow.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the save in some browsers (the download
  // starts asynchronously after click()). Give it time to be picked up first.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
