import { createApplication } from "../../src/application/service.js";
const [home, cwd, userHome, module, signature, point, destination, bundleFiles] = process.argv.slice(2) as string[];
const service = createApplication({ home: home!, cwd: cwd!, userHome: userHome! }, {
  transactionFault: async (current, context) => {
    if (current !== point || destination && context.path !== destination) return;
    process.send?.("ready"); await new Promise(() => undefined);
  }
});
await service.execute({ kind: "adapter.upgrade", name: "test-adapter", module: module!, authorizedSignature: signature!, capabilities: ["link-directory"], ...(bundleFiles ? { bundleFiles: JSON.parse(bundleFiles) } : {}) });
process.disconnect?.();
