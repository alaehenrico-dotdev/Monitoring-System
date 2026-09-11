import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Ala Eh Stocks Monitoring System API listening on http://localhost:${env.port}`);
});
