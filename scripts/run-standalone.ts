#!/usr/bin/env bun

import { bootstrapEnv } from "./bootstrap-env.ts";
import {
  resolveRuntimePorts,
  spawnWithForwardedSignals,
  withRuntimePortEnv,
} from "./runtime-env.ts";

const bootstrappedEnv = bootstrapEnv();
const runtimePorts = resolveRuntimePorts(bootstrappedEnv);
const runtimeEnv = withRuntimePortEnv(bootstrappedEnv, runtimePorts);

spawnWithForwardedSignals(process.execPath, ["server.js"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: runtimeEnv,
});
