import { loadConfig } from "./config";
import { createApp } from "./http/app";
import { serve } from "./node-server";
import { wire } from "./wire";

const config = loadConfig();
const { deps } = await wire(config);
const app = createApp(deps);

serve(app, config.PORT);
console.log(`experience-agent service on http://localhost:${config.PORT} (DS_PACK=${config.DS_PACK})`);
