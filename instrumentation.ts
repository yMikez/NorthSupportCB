export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startStaleCloser } = await import("./lib/staleCloser");
    startStaleCloser();
  }
}
