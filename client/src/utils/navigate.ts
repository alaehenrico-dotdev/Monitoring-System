/// Sends the whole browser window to another address. A function of its own so
/// the one thing a test cannot do - really leave the page - can be replaced.
export function goTo(url: string): void {
  window.location.assign(url);
}
