import { createApplication } from "../../src/application/service.js";
const [options, id, point] = process.argv.slice(2);
const service = createApplication(JSON.parse(options!), { maintenanceFault: async current => {
  if (current === point) { process.send?.({ ready: true }); await new Promise(() => undefined); }
} });
await service.applyMaintenance(id!);
process.exit(0);
